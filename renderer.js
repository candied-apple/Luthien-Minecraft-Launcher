const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const savedUsername = localStorage.getItem('username');
    if (savedUsername) {
        document.getElementById('username').value = savedUsername;
    }
});

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;

        tabContents.forEach(content => {
            content.style.display = content.id === target ? 'block' : 'none';
        });

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
    });
});

document.getElementById('launch').style.display = 'block';

document.getElementById('launch-button').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const minMemory = document.getElementById('min-memory').value + 'G';
    const maxMemory = document.getElementById('max-memory').value + 'G';
    localStorage.setItem('username', username);
    ipcRenderer.send('launch-minecraft', username, { min: minMemory, max: maxMemory });
    document.getElementById('progress-container').style.display = 'block';
});

document.getElementById('min-memory').addEventListener('input', function () {
    document.getElementById('min-memory-value').textContent = this.value + 'G';
});

document.getElementById('max-memory').addEventListener('input', function () {
    document.getElementById('max-memory-value').textContent = this.value + 'G';
});

// Handle progress for file downloads
ipcRenderer.on('progress', (event, progress) => {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const total = progress.total || 100;
    const downloaded = progress.task || 0;
    const percentage = (downloaded / total) * 100;

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${progress.type} indiriliyor: ${downloaded}/${total} (${percentage.toFixed(2)}%)`;

    if (percentage >= 100) {
        setTimeout(() => {
            document.getElementById('progress-container').style.display = 'none';
        }, 2000);
    } else {
        document.getElementById('progress-container').style.display = 'block';
    }
});

// Handle update notifications and progress
ipcRenderer.on('update_available', () => {
    document.getElementById('update-notification').style.display = 'block';
});

ipcRenderer.on('update-progress', (event, percent) => {
    const updateProgressBar = document.getElementById('update-progress-bar');
    const updateProgressText = document.getElementById('update-progress-text');

    updateProgressBar.style.width = `${percent}%`;
    updateProgressText.textContent = `Güncelleme indiriliyor: ${percent.toFixed(2)}%`;

    if (percent >= 100) {
        setTimeout(() => {
            document.getElementById('update-progress-container').style.display = 'none';
        }, 2000);
    } else {
        document.getElementById('update-progress-container').style.display = 'block';
    }
});

ipcRenderer.on('log', (event, message) => {
    const logOutput = document.getElementById('log-output');
    logOutput.textContent += message + '\n';
    logOutput.scrollTop = logOutput.scrollHeight;
});

document.getElementById('restart-button').addEventListener('click', () => {
    ipcRenderer.send('restart_app');
});

document.querySelector("#minimize").addEventListener("click", () => {
    ipcRenderer.send("manualMinimize");
});

document.querySelector("#close").addEventListener("click", () => {
    ipcRenderer.send("manualClose");
});

document.getElementById('your-link').addEventListener('click', (event) => {
    event.preventDefault(); // Prevent default anchor click behavior
    shell.openExternal('https://buymeacoffee.com/candiedapple');
});



document.addEventListener('DOMContentLoaded', () => {
    const fetchUpdateNotes = async () => {
        const url = 'https://files.luthien.com.tr/update-notes.html'; // Replace with the URL of your text file

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.text();
            document.getElementById('update-notes').innerHTML = data; // Update the inner HTML
        } catch (error) {
            console.error('Error fetching the text file:', error);
            document.getElementById('update-notes').innerText = 'İçerik yüklenemedi.'; // Display error message
        }
    };

    fetchUpdateNotes(); // Call the function to fetch update notes
});
