
document.addEventListener('DOMContentLoaded', function() {
    // Get references to HTML elements
    const ecgCanvas = document.getElementById('ecgCanvas');
    const ctx = ecgCanvas.getContext('2d');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const hrDisplay = document.getElementById('hrValue');
    const alertContainer = document.getElementById('alertContainer');

    // --- Get Chart Canvases ---
    const rrIntervalCtx = document.getElementById('rrIntervalChart').getContext('2d');
    const hrDistributionCtx = document.getElementById('hrDistributionChart').getContext('2d');

    // --- Configuration and State ---
    const config = {
        width: ecgCanvas.width,
        height: ecgCanvas.height,
        ecgData: [], // ECG data points
        maxEcgDataPoints: 200, //max points for RR
        simulationSpeed: 30, // ms between new data points. Lower = faster.
        sampleRate: 360, // Simulated sample rate (Hz).
        isRunning: false,
        lastPeakTime: null,
        rrIntervals: [],
        heartRates: [],
        maxHrvDataPoints: 20,

        //Anomaly Detection & Re-alerting Configuration
        alertState: {
            tachycardia: { isActive: false, lastAlertTime: 0 },
            bradycardia: { isActive: false, lastAlertTime: 0 }
        },
        thresholds: {
            tachycardia: 100, // BPM
            bradycardia: 60   // BPM
        },
    };

    // --- Initialize Charts ---
    const rrIntervalChart = new Chart(rrIntervalCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'R-R Interval (ms)', data: [], borderColor: 'rgb(75, 192, 192)', tension: 0.1, fill: false }] },
        options: { responsive: true, scales: { y: { beginAtZero: false, title: { text: 'Milliseconds (ms)' } }, x: { title: { text: 'Beat Number' } } } }
    });

    const hrDistributionChart = new Chart(hrDistributionCtx, {
        type: 'bar',
        data: {
            labels: ['<45', '45-50', '50-55', '55-60', '60-65', '65-70', '70-75', '75-80', '80-85', '85-90', '90-95', '95-100', '>100'],
            datasets: [{
                label: 'Number of Beats',
                data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                backgroundColor: [
                    'rgba(239, 68, 68, 0.2)', // <45
                    'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)',
                    'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)',
                    'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)',
                    'rgba(255, 99, 132, 0.5)', 'rgba(255, 99, 132, 0.5)',
                    'rgba(239, 68, 68, 0.2)'  // >100
                ],
                borderColor: [
                    '#fff', // <45
                    'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)',
                    'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)',
                    'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)',
                    'rgba(255, 99, 132, 1)', 'rgba(255, 99, 132, 1)',
                    '#fff' // >100
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { text: 'Frequency' }
                },
                x: {
                    title: { text: 'Heart Rate (BPM)' }
                }
            }
        }
    });

    // Anomaly Detection & Alert Functions
    function checkForAnomalies(heartRate) {
        const now = Date.now();
        const isTachycardia = heartRate > config.thresholds.tachycardia;
        const isBradycardia = heartRate < config.thresholds.bradycardia;

        // Logic for Tachycardia
        if (isTachycardia) {
            // Trigger a new alert every time the condition is met
            triggerAlert('tachycardia', heartRate);
            config.alertState.tachycardia.isActive = true;
            config.alertState.tachycardia.lastAlertTime = now;
        } else {
            // If the condition is no longer present, reset the alert state
            config.alertState.tachycardia.isActive = false;
        }

        // Logic for Bradycardia
        if (isBradycardia) {
            // Trigger a new alert every time the condition is met
            triggerAlert('bradycardia', heartRate);
            config.alertState.bradycardia.isActive = true;
            config.alertState.bradycardia.lastAlertTime = now;
        } else {
            config.alertState.bradycardia.isActive = false;
        }

        // Update ECG line color based on any active alert
        updateEcgLineColor();
    }

    function triggerAlert(type, heartRate) {
        // Remove the "no alerts" message if it's the first one
        const noAlertElem = alertContainer.querySelector('.no-alert');
        if (noAlertElem) noAlertElem.remove();

        // Limit the number of alerts to 5
        const maxAlerts = 5;
        if (alertContainer.children.length >= maxAlerts) {
            alertContainer.lastChild.remove();
        }

        // Create the alert element
        const alertElem = document.createElement('div');
        alertElem.classList.add('alert', `alert-${type}`);

        // Define alert messages
        const alertMessages = {
            tachycardia: `TACHYCARDIA DETECTED!`,
            bradycardia: `BRADYCARDIA DETECTED!`
        };

        // Get current time for the timestamp
        const now = new Date();
        const timestamp = now.toLocaleTimeString();

        // Format of the alert
        alertElem.innerHTML = `
            <span>${alertMessages[type]} Heart Rate: <strong>${heartRate} BPM</strong></span>
            <span class="alert-timestamp">${timestamp}</span>
        `;

        // Add the alert to the container
        alertContainer.prepend(alertElem); // Prepends so newest are on top
    }

    function updateEcgLineColor() {
        // Check if any alert is active and change the ECG line color accordingly
        draw();
    }

    // Function 1: Generate data points
    // This creates a synthetic ECG waveform using math
    function generateDataPoint() {

        const time = performance.now() / 1000; // Get current time in seconds
        // periodic math signal
        const value = (
            0.3 * Math.sin(2 * Math.PI * 0.5 * time) +
            1.5 * Math.sin(2 * Math.PI * 1.2 * time) * Math.exp(-0.5 * (time % 2))

        );

        // Add random noise to make it look more real
        const noise = (Math.random() - 0.5) * 0.15;

        if (config.isRunning) {
            simulatePeakDetection();
        }
        return value + noise;
    }

    //Function 2: Draw the ECG graph on the canvas
    function draw() {
        // Clear the canvas from previous frame
        ctx.clearRect(0, 0, config.width, config.height);

        //  Draw a green baseline
        ctx.strokeStyle = '#34495e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, config.height / 2);
        ctx.lineTo(config.width, config.height / 2);
        ctx.stroke();

        // Draw the grid lines
        ctx.strokeStyle = '#2a3b4d';
        ctx.lineWidth = 0.5;
        // Draw vertical grid
        for (let x = 0; x < config.width; x += 50) { // Every 50 pixels
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, config.height);
            ctx.stroke();
        }
        // Draw horizontal grid (simulating voltage marks)
        for (let y = 0; y < config.height; y += 50) { // Every 50 pixels
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(config.width, y);
            ctx.stroke();
        }

        // Draw the ECG line - COLOR NOW DEPENDS ON ALERT STATE
        if (config.ecgData.length > 1) {
            // NEW: Choose color based on alert state
            if (config.alertState.tachycardia.isActive) {
                ctx.strokeStyle = '#ff0000'; // Red for Tachycardia
            } else if (config.alertState.bradycardia.isActive) {
                ctx.strokeStyle = '#0096FF'; // Blue for Bradycardia
            } else {
                ctx.strokeStyle = '#00ff8c'; // Classic Green for normal rhythm
            }

            ctx.lineWidth = 2;
            ctx.beginPath();

            // Calculate the X step based on canvas width and data points
            const stepX = config.width / (config.maxEcgDataPoints - 1);

            // Move to the first data point
            let x = 0;
            // The Y coordinate: center of canvas + data value
            let y = (config.height / 2) - (config.ecgData[0] * 40); // 40 is a scaling factor
            ctx.moveTo(x, y);

            // Draw a line to each subsequent data point
            for (let i = 1; i < config.ecgData.length; i++) {
                x = i * stepX;
                y = (config.height / 2) - (config.ecgData[i] * 40); // Invert Y axis so positive is up
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // Heart rate is updated in updateHrvCharts
    }

    function simulatePeakDetection() {
        const now = Date.now();
        if (config.lastPeakTime === null || now - config.lastPeakTime > 1200) {
            if (config.lastPeakTime !== null) {
                const newRrInterval = now - config.lastPeakTime;
                updateHrvCharts(newRrInterval);
            }
            config.lastPeakTime = now;
        }
    }

    function updateHrvCharts(rrInterval) {
        const newHeartRate = Math.round(60000 / rrInterval);

        // NEW: Check for anomalies with the new heart rate!
        checkForAnomalies(newHeartRate);

        // Update the R-R Interval Line Chart
        config.rrIntervals.push(rrInterval);
        rrIntervalChart.data.labels.push(`Beat ${rrIntervalChart.data.labels.length + 1}`);
        rrIntervalChart.data.datasets[0].data.push(rrInterval);
        if (config.rrIntervals.length > config.maxHrvDataPoints) {
            config.rrIntervals.shift();
            rrIntervalChart.data.labels.shift();
            rrIntervalChart.data.datasets[0].data.shift();
        }
        rrIntervalChart.update('active');

        // Update the Heart Rate Distribution Histogram
        config.heartRates.push(newHeartRate);
        const distributionData = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        config.heartRates.forEach(hr => {
            if (hr < 45) distributionData[0]++;
            else if (hr >= 45 && hr < 50) distributionData[1]++;
            else if (hr >= 50 && hr < 55) distributionData[2]++;
            else if (hr >= 55 && hr < 60) distributionData[3]++;
            else if (hr >= 60 && hr < 65) distributionData[4]++;
            else if (hr >= 65 && hr < 70) distributionData[5]++;
            else if (hr >= 70 && hr < 75) distributionData[6]++;
            else if (hr >= 75 && hr < 80) distributionData[7]++;
            else if (hr >= 80 && hr < 85) distributionData[8]++;
            else if (hr >= 85 && hr < 90) distributionData[9]++;
            else if (hr >= 90 && hr < 95) distributionData[10]++;
            else if (hr >= 95 && hr < 100) distributionData[11]++;
            else if (hr >= 100) distributionData[12]++;
        });
        hrDistributionChart.data.datasets[0].data = distributionData;
        hrDistributionChart.update('active');

        hrDisplay.textContent = `HR: ${newHeartRate} bpm`;
    }

    function update() {
        if (!config.isRunning) return;
        const newPoint = generateDataPoint();
        config.ecgData.push(newPoint);

        //If we have too many points, remove the oldest one
        if (config.ecgData.length > config.maxEcgDataPoints) {
            config.ecgData.shift(); // Removes the first element
        }

        // Redraw the entire graph
        draw();

        // Schedule the next update, creating the animation loop
        setTimeout(update, config.simulationSpeed);
    }

    // Function 4: Start the simulation
    function startSimulation() {
        if (config.isRunning) return;
        config.isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        config.ecgData = []; // Clear old data
        config.rrIntervals = [];
        config.heartRates = [];
        config.lastPeakTime = null;
        // NEW: Reset alert state and UI
        config.alertState.tachycardia = { isActive: false, lastAlertTime: 0 };
        config.alertState.bradycardia = { isActive: false, lastAlertTime: 0 };
        alertContainer.innerHTML = '<p class="no-alert">No anomalies detected.</p>'; // Clear previous alerts

        rrIntervalChart.data.labels = [];
        rrIntervalChart.data.datasets[0].data = [];
        rrIntervalChart.update();
        hrDistributionChart.data.datasets[0].data = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        hrDistributionChart.update();
        update(); // Start the loop
    }

    // Function 5: Stop the simulation
    function stopSimulation() {
        config.isRunning = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }

    // Attach event listeners to the buttons
    startBtn.addEventListener('click', startSimulation);
    stopBtn.addEventListener('click', stopSimulation);

    // Draw the initial static canvas
    draw();
});
