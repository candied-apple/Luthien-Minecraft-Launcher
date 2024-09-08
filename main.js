const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client, Authenticator } = require('minecraft-launcher-core');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater'); // Import autoUpdater

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    // Get the user data directory
    const userDataPath = path.normalize(app.getPath('userData'));
    const minecraftPath = path.join(userDataPath, 'luthienminecraft');
    const authlibInjectorPath = path.join(minecraftPath, 'authlib-injector.jar');
    let mainWindow;

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 820,
            height: 620,
            autoHideMenuBar: true,
            transparent: true,
            resizable: false,
            frame: false,
            webPreferences: {
                preload: path.join(__dirname, 'renderer.js'),
                contextIsolation: false,
                nodeIntegration: true
            }
        });
        mainWindow.loadFile('index.html');
        mainWindow.on('closed', function () {
            mainWindow = null;
        });
    }

    app.on('ready', () => {
        createWindow();
        autoUpdater.checkForUpdatesAndNotify(); // Check for updates when the app is ready
    });

    app.on('window-all-closed', function () {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', function () {
        if (mainWindow === null) {
            createWindow();
        }
    });

    // Handle second instance
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Focus on the main window if the user tried to open another instance
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // Handle auto-updates
    autoUpdater.on('update-available', () => {
        mainWindow.webContents.send('update_available');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const { percent } = progressObj;
        mainWindow.webContents.send('update-progress', percent); // Send progress to renderer
    });

    autoUpdater.on('update-downloaded', () => {
        mainWindow.webContents.send('update_downloaded');
    });

    ipcMain.on('restart_app', () => {
        autoUpdater.quitAndInstall(); // Restart and install the update
    });

    // Handle launching Minecraft
    ipcMain.on('launch-minecraft', async (event, username, password, memory) => {
        const updateResult = await updateFiles(event);

        if (updateResult) {
            const customApiUrl = 'https://skins.luthien.com.tr/api/yggdrasil/authserver';
            Authenticator.changeApiUrl(customApiUrl);
            const launcher = new Client();
            const opts = {
                authorization: Authenticator.getAuth(username, password),
                root: path.join(minecraftPath),
                version: {
                    number: "1.20.1",
                    type: "release",
                    custom: "fabric-loader-0.15.11-1.20.1"
                },
                memory: {
                    max: memory.max,
                    min: memory.min
                },
                overrides: {
                    detached: false,
                },
                customArgs: [
                    `-javaagent:${authlibInjectorPath}=https://skins.luthien.com.tr/api/yggdrasil`,
                    "-Duser.language=en",
                    "-Duser.country=US"
                ]

            };

            launcher.launch(opts);

            launcher.on('debug', (e) => {
                console.log(e);
                mainWindow.webContents.send('log', e);
            });
            launcher.on('data', (e) => {
                console.log(e);
                mainWindow.webContents.send('log', e);
            });
            launcher.on('progress', (e) => {
                mainWindow.webContents.send('progress', e);
            });
        }
    });

    // Update the updateFiles function to accept event
    async function updateFiles(event) {
        return new Promise((resolve, reject) => {
            const filesUrl = 'https://files.luthien.com.tr/files.json';
            const whitelistUrl = 'https://files.luthien.com.tr/whitelisted_files.json';
    
            let filesToKeep = new Set();
            let directoriesToKeep = new Set();
            let prefixesToKeep = [];
    
            // Fetch and parse whitelist
            https.get(whitelistUrl, (response) => {
                let whitelistData = '';
                response.on('data', chunk => {
                    whitelistData += chunk;
                });
                response.on('end', () => {
                    try {
                        const whitelist = JSON.parse(whitelistData);
                        whitelist.files.forEach(file => filesToKeep.add(file));
                        whitelist.directories.forEach(dir => directoriesToKeep.add(path.normalize(dir)));
    
                        if (whitelist.prefixes) {
                            prefixesToKeep = whitelist.prefixes.map(prefix => prefix.toLowerCase());
                        }
    
                        // Fetch and parse files list
                        https.get(filesUrl, (response) => {
                            let data = '';
                            response.on('data', chunk => {
                                data += chunk;
                            });
                            response.on('end', () => {
                                try {
                                    const files = JSON.parse(data);
                                    let totalFiles = files.length;
                                    let processedFiles = 0;
    
                                    // Add files from files.json to the set of files to keep
                                    files.forEach(file => filesToKeep.add(path.normalize(file.filename)));
    
                                    // Process files from files.json
                                    files.forEach(file => {
                                        const filename = file.filename;
                                        const expectedHash = file.hash;
                                        const fileUrl = `https://files.luthien.com.tr/files/${filename}`;
                                        const fullPath = path.join(minecraftPath, filename);
    
                                        let fileExists = fs.existsSync(fullPath);
                                        let fileHash = '';
    
                                        if (fileExists) {
                                            fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                            if (fileHash === expectedHash) {
                                                console.log(`File ${filename} is up to date.`);
                                                processedFiles++;
                                                checkProgress();
                                                return;
                                            } else {
                                                console.log(`File ${filename} has changed. Downloading the updated file...`);
                                            }
                                        } else {
                                            console.log(`File ${filename} does not exist. Downloading...`);
                                        }
    
                                        const directory = path.dirname(fullPath);
                                        try {
                                            if (!fs.existsSync(directory)) {
                                                fs.mkdirSync(directory, { recursive: true });
                                            }
                                        } catch (err) {
                                            console.error(`Failed to create directory ${directory}:`, err);
                                            processedFiles++;
                                            checkProgress();
                                            return;
                                        }
    
                                        downloadFile(fileUrl, fullPath).then(() => {
                                            const downloadedFileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                            if (downloadedFileHash !== expectedHash) {
                                                console.log(`Hash mismatch after download for file ${filename}.`);
                                            } else {
                                                console.log(`File ${filename} downloaded successfully and is up to date.`);
                                            }
                                            processedFiles++;
                                            checkProgress();
                                        }).catch(err => {
                                            console.error(`Failed to download ${filename}:`, err);
                                            processedFiles++;
                                            checkProgress();
                                        });
                                    });
    
                                    // Remove files not in files.json or not whitelisted
                                    function removeOldFiles() {
                                        function deleteDirectoryRecursively(dirPath) {
                                            fs.readdir(dirPath, (err, files) => {
                                                if (err) {
                                                    console.error(`Failed to read directory ${dirPath}:`, err);
                                                    return;
                                                }
                                                files.forEach(file => {
                                                    const fullPath = path.join(dirPath, file);
                                                    fs.stat(fullPath, (err, stats) => {
                                                        if (err) {
                                                            console.error(`Failed to get stats for ${fullPath}:`, err);
                                                            return;
                                                        }
                                                        if (stats.isDirectory()) {
                                                            // Recurse into subdirectory
                                                            deleteDirectoryRecursively(fullPath);
                                                        } else {
                                                            const relativeFilePath = path.relative(minecraftPath, fullPath);
                                                            const baseDir = relativeFilePath.split(path.sep)[0];
    
                                                            const fileName = path.basename(relativeFilePath);
    
                                                            // Check if the file is not in files.json, its base directory is not whitelisted, and it does not match any whitelisted prefix
                                                            if (
                                                                !filesToKeep.has(relativeFilePath) &&
                                                                !directoriesToKeep.has(baseDir) &&
                                                                !prefixesToKeep.some(prefix => fileName.toLowerCase().startsWith(prefix))
                                                            ) {
                                                                fs.unlink(fullPath, (err) => {
                                                                    if (err) {
                                                                        console.error(`Failed to delete file ${fullPath}:`, err);
                                                                    } else {
                                                                        console.log(`Deleted file ${fullPath}`);
                                                                    }
                                                                });
                                                            }
                                                        }
                                                    });
                                                });
    
                                                // After processing files, check if directory should be deleted
                                                fs.readdir(dirPath, (err, remainingFiles) => {
                                                    if (err) {
                                                        console.error(`Failed to read directory ${dirPath} after deletion:`, err);
                                                        return;
                                                    }
                                                    if (remainingFiles.length === 0 && !directoriesToKeep.has(path.relative(minecraftPath, dirPath)) && !prefixesToKeep.some(prefix => path.basename(dirPath).toLowerCase().startsWith(prefix))) {
                                                        fs.rmdir(dirPath, (err) => {
                                                            if (err) {
                                                                console.error(`Failed to delete directory ${dirPath}:`, err);
                                                            } else {
                                                                console.log(`Deleted directory ${dirPath}`);
                                                            }
                                                        });
                                                    }
                                                });
                                            });
                                        }
    
                                        deleteDirectoryRecursively(minecraftPath);
    
                                        resolve(true);
                                    }
    
                                    function checkProgress() {
                                        mainWindow.webContents.send('progress', {
                                            total: totalFiles,
                                            task: processedFiles,
                                            type: 'Sunucu dosyaları'
                                        });
    
                                        if (processedFiles === totalFiles) {
                                            removeOldFiles(); // Remove files not in the list
                                        }
                                    }
                                } catch (error) {
                                    reject(`Failed to parse file list: ${error.message}`);
                                }
                            });
                        }).on('error', (err) => {
                            reject(`Failed to fetch file list: ${err.message}`);
                        });
                    } catch (error) {
                        reject(`Failed to parse whitelist: ${error.message}`);
                    }
                });
            }).on('error', (err) => {
                reject(`Failed to fetch whitelist: ${err.message}`);
            });
        });
    }
    
    // Helper function to download a file
    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            }).on('error', (err) => {
                fs.unlink(dest, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error(`Failed to delete file: ${unlinkErr}`);
                    }
                });
                reject(err);
            });
        });
    }

    ipcMain.on("manualMinimize", () => {
        mainWindow.minimize();
    });

    ipcMain.on("manualClose", () => {
        app.quit();
    });
}
