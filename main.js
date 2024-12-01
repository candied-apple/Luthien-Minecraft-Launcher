const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { fabric } = require('tomate-loaders');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const mysql = require('mysql');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

// MySQL connection setup
const connection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL');
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    // Initialize paths
    const userDataPath = path.normalize(app.getPath('userData'));
    const minecraftPath = path.join(userDataPath, 'luthienminecraft');
    const authlibInjectorPath = path.join(minecraftPath, 'authlib-injector.jar');
    let mainWindow;

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 800,
            height: 700,
            frame: false,
            resizable: false,
            transparent: true,
            backgroundColor: '#00000000',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            }
        });

        mainWindow.loadFile('index.html');
        
        mainWindow.on('closed', () => {
            mainWindow = null;
        });
    }

    // App lifecycle events
    app.whenReady().then(() => {
        createWindow();
        autoUpdater.checkForUpdatesAndNotify();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        if (mainWindow === null) {
            createWindow();
        }
    });

    // Handle second instance
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    // Auto-updater events
    autoUpdater.on('update-available', () => {
        mainWindow.webContents.send('update_available');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow.webContents.send('update-progress', progressObj.percent);
    });

    autoUpdater.on('update-downloaded', () => {
        mainWindow.webContents.send('update_downloaded');
    });

    // IPC handlers
    ipcMain.on('minimize-window', () => {
        mainWindow.minimize();
    });

    ipcMain.on('restart_app', () => {
        autoUpdater.quitAndInstall();
    });

    ipcMain.on('manualMinimize', () => {
        mainWindow.minimize();
    });

    ipcMain.on('manualClose', () => {
        app.quit();
    });

    let isGameRunning = false;

    // Minecraft launch handler
    ipcMain.on('launch-minecraft', async (event, username, password, memory) => {
        if (isGameRunning) {
            event.reply('launch-result', 'Game is already running');
            return;
        }
    
        isGameRunning = true;
        mainWindow.webContents.send('update-launch-button', isGameRunning);
    
        // Query the database for the user's password hash
        connection.query('SELECT password FROM users WHERE email = ?', [username], async (err, results) => {
            if (err) {
                console.error('Error querying the database:', err);
                event.reply('login-result', 'Error querying the database');
                isGameRunning = false;
                mainWindow.webContents.send('update-launch-button', isGameRunning);
                return;
            }
    
            if (results.length === 0) {
                event.reply('login-result', 'User not found');
                isGameRunning = false;
                mainWindow.webContents.send('update-launch-button', isGameRunning);
                return;
            }
    
            const storedHash = results[0].password;
    
            // Verify the password
            try {
                const isMatch = bcrypt.compareSync(password, storedHash);
                if (isMatch) {
                    event.reply('login-result', 'Password is correct');
                    // Proceed with launching Minecraft
    
                    const updateResult = await updateFiles(event);
    
                    if (updateResult) {
                        const customApiUrl = 'https://skins.shukketsu.app/api/yggdrasil/authserver';
                        Authenticator.changeApiUrl(customApiUrl);
                        const launcher = new Client();
                        const launchConfig = await fabric.getMCLCLaunchConfig({
                            gameVersion: '1.21.1',
                            rootPath: path.join(minecraftPath),
                        });
    
                        const opts = {
                            authorization: Authenticator.getAuth(username, password),
                            ...launchConfig,
                            memory: memory,
                            overrides: {
                                detached: false,
                            },
                            customArgs: [
                                `-javaagent:${authlibInjectorPath}=https://skins.shukketsu.app/api/yggdrasil`,
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
    
                        launcher.on('close', () => {
                            isGameRunning = false;
                            mainWindow.webContents.send('update-launch-button', isGameRunning);
                        });
                    } else {
                        isGameRunning = false;
                        mainWindow.webContents.send('update-launch-button', isGameRunning);
                    }
                } else {
                    event.reply('login-result', 'Password is incorrect');
                    isGameRunning = false;
                    mainWindow.webContents.send('update-launch-button', isGameRunning);
                }
            } catch (err) {
                console.error('Error comparing passwords:', err);
                event.reply('login-result', 'Error comparing passwords');
                isGameRunning = false;
                mainWindow.webContents.send('update-launch-button', isGameRunning);
            }
        });
    });

    // Update the updateFiles function to accept event
    async function updateFiles(event) {
        return new Promise((resolve, reject) => {
            const filesUrl = 'https://files.shukketsu.app/files.json';
            const whitelistUrl = 'https://files.shukketsu.app/whitelisted_files.json';

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
                                        const fileUrl = `https://files.shukketsu.app/files/${filename}`;
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
}