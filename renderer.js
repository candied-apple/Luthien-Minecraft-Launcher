const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Existing tab button functionality
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
    });
});

document.getElementById('launch-button').addEventListener('click', function(event) {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const minMemory = document.getElementById('min-memory').value + 'G';
    const maxMemory = document.getElementById('max-memory').value + 'G';

    
    // Save credentials
    localStorage.setItem('username', username);
    localStorage.setItem('password', password);

    // Send launch event to main process
    ipcRenderer.send('launch-minecraft', username, password, {
        min: minMemory,
        max: maxMemory
    });
});

ipcRenderer.on('login-result', (event, message) => {
    if (message === 'Password is correct') {
        
    // Show progress container
    document.getElementById('progress-container').style.display = 'block';
        // Proceed with showing progress or launching the game
    } else {
        // Show error message to the user
        document.getElementById('feedback-message').textContent = message;
    }
});

// Window controls
document.querySelector('.titlebar-button.close').addEventListener('click', () => {
    window.close();
});

document.querySelector('.titlebar-button.minimize').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

// Password visibility toggle (keeping existing implementation)
document.querySelector('.password-toggle').addEventListener('click', function() {
    const inputGroup = this.closest('.input-group');
    const passwordInput = inputGroup.querySelector('input[type="password"]') || inputGroup.querySelector('input[type="text"]');
    
    if (passwordInput) {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
        
        console.log('Password visibility toggled:', type);
    } else {
        console.error('Password input not found');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Load saved username
    const savedUsername = localStorage.getItem('username');
    if (savedUsername) {
        document.getElementById('username').value = savedUsername;
    }

    // Load saved password
    const savedPassword = localStorage.getItem('password');
    if (savedPassword) {
        document.getElementById('password').value = savedPassword;
    }

    // Load saved min memory
    const savedMinMemory = localStorage.getItem('minMemory');
    if (savedMinMemory) {
        document.getElementById('min-memory').value = savedMinMemory;
        document.getElementById('min-memory-value').textContent = savedMinMemory + 'G';
    }

    // Load saved max memory
    const savedMaxMemory = localStorage.getItem('maxMemory');
    if (savedMaxMemory) {
        document.getElementById('max-memory').value = savedMaxMemory;
        document.getElementById('max-memory-value').textContent = savedMaxMemory + 'G';
    }

    // Fetch update notes
    const fetchUpdateNotes = async () => {
        try {
            const response = await fetch('https://files.shukketsu.app/update-notes.html');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.text();
            document.getElementById('notes').innerHTML = data;
        } catch (error) {
            console.error('Error fetching the text file:', error);
            document.getElementById('notes').innerText = 'Failed to load content.';
        }
    };
    fetchUpdateNotes();
    
    // Fetch online status
    const fetchOnlineStatus = async () => {
        try {
            const response = await fetch('https://api.mcsrvstat.us/2/shukketsu.app');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            const onlineStatus = `${data.players.online}/${data.players.max}`;
            document.querySelector('.profile-section p').textContent = `Online Status: ${onlineStatus}`;
        } catch (error) {
            console.error('Error fetching the online status:', error);
            document.querySelector('.profile-section p').textContent = 'Online Status: N/A';
        }
    };
    fetchOnlineStatus();
    setInterval(fetchOnlineStatus, 20000); // Update every 20 seconds

});



// Memory slider handlers
document.getElementById('min-memory').addEventListener('input', function () {
    const minMemoryValue = this.value + 'G';
    document.getElementById('min-memory-value').textContent = minMemoryValue;
    localStorage.setItem('minMemory', this.value);
});

document.getElementById('max-memory').addEventListener('input', function () {
    const maxMemoryValue = this.value + 'G';
    document.getElementById('max-memory-value').textContent = maxMemoryValue;
    localStorage.setItem('maxMemory', this.value);
});
// Progress handlers
ipcRenderer.on('progress', (event, progress) => {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const total = progress.total || 100;
    const downloaded = progress.task || 0;
    const percentage = (downloaded / total) * 100;

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${progress.type} downloading: ${downloaded}/${total} (${percentage.toFixed(2)}%)`;

    document.getElementById('progress-container').style.display = percentage >= 100 ? 'none' : 'block';
});

// Update notification handlers
ipcRenderer.on('update_available', () => {
    document.getElementById('update-notification').style.display = 'block';
});

ipcRenderer.on('update-progress', (event, percent) => {
    const updateProgressBar = document.getElementById('update-progress-bar');
    const updateProgressText = document.getElementById('update-progress-text');

    updateProgressBar.style.width = `${percent}%`;
    updateProgressText.textContent = `Update downloading: ${percent.toFixed(2)}%`;

    document.getElementById('update-progress-container').style.display = percent >= 100 ? 'none' : 'block';
});

ipcRenderer.on('update_downloaded', () => {
    document.getElementById('restart-button').style.display = 'block';
});

// Log handler
ipcRenderer.on('log', (event, message) => {
    const logOutput = document.getElementById('log-output');
    logOutput.textContent += message + '\n';
});

const logOutput = document.getElementById('log-output');
const scrollToBottomButton = document.getElementById('scroll-to-bottom');

// Show the button when the user scrolls up
logOutput.addEventListener('scroll', () => {
    if (logOutput.scrollTop < logOutput.scrollHeight - logOutput.clientHeight) {
        scrollToBottomButton.style.display = 'block';
    } else {
        scrollToBottomButton.style.display = 'none';
    }
});

// Scroll to the bottom when the button is clicked
scrollToBottomButton.addEventListener('click', () => {
    logOutput.scrollTop = logOutput.scrollHeight;
});
// Button handlers
document.getElementById('restart-button').addEventListener('click', () => {
    ipcRenderer.send('restart_app');
});


// Open credits links in external browser
document.querySelectorAll('#credits a').forEach(link => {
    link.addEventListener('click', (event) => {
        event.preventDefault();
        shell.openExternal(link.href);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const launchButton = document.getElementById('launch-button');
    const emailInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const feedbackMessage = document.getElementById('feedback-message');

    function toggleLaunchButton() {
        const isEmailEmpty = !emailInput.value;
        const isPasswordEmpty = !passwordInput.value;
        const shouldDisable = isEmailEmpty || isPasswordEmpty;
        launchButton.disabled = shouldDisable;
        launchButton.classList.toggle('disabled', shouldDisable);
        feedbackMessage.textContent = isEmailEmpty || isPasswordEmpty ? 'Both email and password are required.' : '';
    }

    emailInput.addEventListener('input', toggleLaunchButton);
    passwordInput.addEventListener('input', toggleLaunchButton);

    ipcRenderer.on('update-launch-button', (event, isGameRunning) => {
        launchButton.disabled = isGameRunning;
        launchButton.classList.toggle('disabled', isGameRunning);
        launchButton.textContent = isGameRunning ? 'Game Running...' : 'Launch Minecraft';
    });

    // Initial check
    toggleLaunchButton();
});