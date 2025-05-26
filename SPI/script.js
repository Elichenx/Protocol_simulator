document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const cpolRadios = document.querySelectorAll('input[name="cpol"]');
    const cphaRadios = document.querySelectorAll('input[name="cpha"]');
    const masterDataInput = document.getElementById('masterData');
    const slaveDataInput = document.getElementById('slaveData');
    const startButton = document.getElementById('startButton');
    const speedInput = document.getElementById('speed');
    const statusSpan = document.getElementById('status');
    const ssDiv = document.getElementById('ss');
    const sclkDiv = document.getElementById('sclk');
    const mosiDiv = document.getElementById('mosi');
    const misoDiv = document.getElementById('miso');
    const currentByteSpan = document.getElementById('currentByte');
    const logOutput = document.getElementById('logOutput');
    
    // 位显示元素
    const bitElements = {
        b7: document.getElementById('bit7'), b6: document.getElementById('bit6'),
        b5: document.getElementById('bit5'), b4: document.getElementById('bit4'),
        b3: document.getElementById('bit3'), b2: document.getElementById('bit2'),
        b1: document.getElementById('bit1'), b0: document.getElementById('bit0')
    };
    
    // Canvas Elements
    const canvasContainer = document.getElementById('sequenceDiagramContainer');
    const canvas = document.getElementById('sequenceCanvas');
    const ctx = canvas.getContext('2d');

    // Simulation State
    let simulationRunning = false;
    let simulationTimeout = null;
    let currentState = 'IDLE';
    let currentStep = 0;
    let masterByte = 0;   // 主机发送的数据
    let slaveByte = 0;    // 从机发送的数据
    let simulationSteps = [];
    let activeBit = -1; // Current bit being transferred (-1 means none)
    let cpol = 0;       // 时钟极性: 0=空闲低，1=空闲高
    let cpha = 0;       // 时钟相位: 0=第一边沿采样，1=第二边沿采样
    let dataBits = 8;   // 固定为8位数据

    // Canvas Drawing Constants & State
    const H_STEP = 15;       // Horizontal pixels per clock step
    const V_SPACING = 40;    // Vertical space between signal lines
    const V_OFFSET_TOP = 30; // Top padding inside canvas
    const SS_Y = V_OFFSET_TOP;
    const SCLK_Y = V_OFFSET_TOP + V_SPACING;
    const MOSI_Y = V_OFFSET_TOP + V_SPACING * 2;
    const MISO_Y = V_OFFSET_TOP + V_SPACING * 3;
    const HIGH_LEVEL_OFFSET = 0; // Y offset for high level (relative to line Y)
    const LOW_LEVEL_OFFSET = 15; // Y offset for low level
    const LABEL_Y = MISO_Y + V_SPACING; // Y position for labels

    const COLOR_SS = '#6610f2';   // Purple
    const COLOR_SCLK = '#007bff'; // Blue
    const COLOR_MOSI = '#17a2b8'; // Teal
    const COLOR_MISO = '#fd7e14'; // Orange
    const COLOR_LABEL = '#6c757d'; // Gray
    const COLOR_BIT_LABEL = '#888';
    const COLOR_HIGH_INDICATOR = getComputedStyle(document.documentElement).getPropertyValue('--signal-high-bg').trim();
    const COLOR_LOW_INDICATOR = getComputedStyle(document.documentElement).getPropertyValue('--signal-low-bg').trim();

    let currentX = 0; // Current horizontal drawing position on canvas
    let totalStepsEstimate = 0; // Used to estimate canvas width

    // --- Helper Functions ---

    function log(message) {
        logOutput.value += message + '\n';
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    function setSignalDiv(div, level) {
        const isHigh = level === 1 || level === true;
        div.classList.toggle('high', isHigh);
        div.classList.toggle('low', !isHigh);
        div.textContent = `${div.id.toUpperCase()} (${isHigh ? '高' : '低'})`;
        return isHigh; // Return boolean state
    }

    function updateStatus(text) {
        statusSpan.textContent = `状态: ${text}`;
    }

    function updateCurrentByteDisplay(value) {
        if (value === null) {
            currentByteSpan.textContent = '--';
        } else {
            currentByteSpan.textContent = formatHex(value);
        }
    }

    function clearBitHighlights() {
        Object.values(bitElements).forEach(el => {
            if (!el) return;
            el.classList.remove('active', 'high', 'low');
        });
    }

    function highlightBit(bitIndex, level) {
        if (bitIndex < 0 || bitIndex >= dataBits) return;
        
        clearBitHighlights();
        
        const bitId = `b${bitIndex}`;
        const bitEl = bitElements[bitId];
        
        if (bitEl) {
            const isHigh = level === 1 || level === true;
            bitEl.classList.add('active');
            bitEl.classList.toggle('high', isHigh);
            bitEl.classList.toggle('low', !isHigh);
        }
    }

    function resetBitDisplay() {
        clearBitHighlights();
    }

    function parseHexInput(inputElement, bits) {
        const hexValue = inputElement.value.trim().toUpperCase();
        inputElement.value = hexValue; // Ensure uppercase display
        const maxValue = Math.pow(2, bits) - 1;
        if (!/^[0-9A-F]+$/.test(hexValue)) {
            alert(`无效的十六进制输入: ${hexValue} (只允许 0-9, A-F)`);
            return null;
        }
        const value = parseInt(hexValue, 16);
        if (isNaN(value) || value < 0 || value > maxValue) {
            const maxHex = maxValue.toString(16).toUpperCase().padStart(bits / 4, '0');
            alert(`无效的 ${bits}-bit 十六进制值: 0x${hexValue}. 范围应在 0x00 到 0x${maxHex} 之间.`);
            return null;
        }
        return value;
    }

    function formatHex(value, nybbles = 2) {
        return `0x${value.toString(16).toUpperCase().padStart(nybbles, '0')}`;
    }

    // --- Canvas Drawing Functions ---

    function setupCanvas() {
        // Estimate total steps: SS_Low + bits*2 + SS_High + additional padding
        totalStepsEstimate = 2 + dataBits * 2 + 2 + 6; // 增加了额外的padding从4到6
        const canvasWidth = totalStepsEstimate * H_STEP + 100; // 增加额外宽度从80到100
        const canvasHeight = LABEL_Y + 50; // 增加高度从30到50，确保有足够空间显示所有内容

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear previous drawings

        // Set common styles
        ctx.lineWidth = 2;
        ctx.font = '11px var(--font-family)';
        ctx.textBaseline = 'middle';

        // Draw initial labels
        ctx.fillStyle = COLOR_LABEL;
        ctx.textAlign = 'right';
        ctx.fillText('SS', H_STEP * 2 - 5, SS_Y + LOW_LEVEL_OFFSET / 2);
        ctx.fillText('SCLK', H_STEP * 2 - 5, SCLK_Y + LOW_LEVEL_OFFSET / 2);
        ctx.fillText('MOSI', H_STEP * 2 - 5, MOSI_Y + LOW_LEVEL_OFFSET / 2);
        ctx.fillText('MISO', H_STEP * 2 - 5, MISO_Y + LOW_LEVEL_OFFSET / 2);
        ctx.textAlign = 'left'; // Reset alignment

        currentX = H_STEP * 2; // Starting X position after labels
    }

    function drawLineSegment(yPos, startX, endX, level) {
        const y = yPos + (level ? HIGH_LEVEL_OFFSET : LOW_LEVEL_OFFSET);
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }

    function drawVerticalLine(xPos, startY, endY) {
        ctx.moveTo(xPos, startY);
        ctx.lineTo(xPos, endY);
    }

    function drawStep(ssLevel, sclkLevel, mosiLevel, misoLevel, durationSteps = 1) {
        const startX = currentX;
        const endX = currentX + durationSteps * H_STEP;

        // Draw SS segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_SS;
        drawLineSegment(SS_Y, startX, endX, ssLevel);
        ctx.stroke();

        // Draw SCLK segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_SCLK;
        drawLineSegment(SCLK_Y, startX, endX, sclkLevel);
        ctx.stroke();

        // Draw MOSI segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_MOSI;
        drawLineSegment(MOSI_Y, startX, endX, mosiLevel);
        ctx.stroke();

        // Draw MISO segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_MISO;
        drawLineSegment(MISO_Y, startX, endX, misoLevel);
        ctx.stroke();

        currentX = endX; // Move drawing cursor
        canvasContainer.scrollLeft = Math.max(0, currentX - canvasContainer.clientWidth + 50); // Auto scroll
    }

    // Draws vertical edges when a signal changes state *at* a specific X coordinate
    function drawSignalChangeEdge(xPos, signalY, oldLevel, newLevel, color) {
        if (oldLevel !== newLevel) {
            const y1 = signalY + (oldLevel ? HIGH_LEVEL_OFFSET : LOW_LEVEL_OFFSET);
            const y2 = signalY + (newLevel ? HIGH_LEVEL_OFFSET : LOW_LEVEL_OFFSET);
            ctx.beginPath();
            ctx.strokeStyle = color;
            drawVerticalLine(xPos, y1, y2);
            ctx.stroke();
        }
    }

    function drawLabel(text, xPos = currentX, yPos = LABEL_Y, color = COLOR_LABEL, align = 'center') {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.fillText(text, xPos, yPos);
        ctx.textAlign = 'left'; // Reset alignment
    }

    function drawBitLabel(text, xPos, yPos = SCLK_Y - 15, color = COLOR_BIT_LABEL, align = 'center') {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.font = '10px var(--font-family)'; // Smaller font for bit labels
        ctx.fillText(text, xPos, yPos);
        ctx.font = '11px var(--font-family)'; // Reset font
        ctx.textAlign = 'left'; // Reset alignment
    }

    // --- Simulation Step Functions ---

    function buildSimulationSteps() {
        simulationSteps = [];
        
        let prevSs = true;      // Initial idle state (SS high, inactive)
        let prevSclk = cpol;    // Initial clock state depends on CPOL
        let prevMosi = false;   // Initial state doesn't matter much
        let prevMiso = false;   // Initial state doesn't matter much

        // Helper for adding simulation steps
        const addStep = (desc, ss, sclk, mosi, miso, duration = 1, label = null, bitLabel = null, bitIndex = -1) => {
            simulationSteps.push({
                desc: desc,
                action: () => {
                    const currentSs = setSignalDiv(ssDiv, ss);
                    const currentSclk = setSignalDiv(sclkDiv, sclk);
                    const currentMosi = setSignalDiv(mosiDiv, mosi);
                    const currentMiso = setSignalDiv(misoDiv, miso);
                    const startDrawX = currentX; // X before drawing this step

                    // Draw edges *before* drawing the horizontal segment
                    drawSignalChangeEdge(startDrawX, SS_Y, prevSs, currentSs, COLOR_SS);
                    drawSignalChangeEdge(startDrawX, SCLK_Y, prevSclk, currentSclk, COLOR_SCLK);
                    drawSignalChangeEdge(startDrawX, MOSI_Y, prevMosi, currentMosi, COLOR_MOSI);
                    drawSignalChangeEdge(startDrawX, MISO_Y, prevMiso, currentMiso, COLOR_MISO);

                    // Draw the horizontal lines for this step's duration
                    drawStep(currentSs, currentSclk, currentMosi, currentMiso, duration);

                    // Draw labels if provided
                    if (label) {
                        drawLabel(label, startDrawX + (duration * H_STEP) / 2);
                    }
                    
                    if (bitLabel !== null) {
                        drawBitLabel(bitLabel.toString(), startDrawX + (duration * H_STEP) / 2);
                    }
                    
                    // Update bit display if requested
                    if (bitIndex >= 0) {
                        // 这里只显示主机发送的位
                        highlightBit(bitIndex, currentMosi);
                    }

                    // Update previous state for next edge drawing
                    prevSs = currentSs;
                    prevSclk = currentSclk;
                    prevMosi = currentMosi;
                    prevMiso = currentMiso;
                }
            });
        };

        // 1. Initial Idle State
        addStep("总线空闲", true, cpol, false, false, 3, "Idle");

        // 2. SS goes low to begin transaction
        addStep("SS 拉低, 开始传输", false, cpol, false, false, 2, "Start");
        updateCurrentByteDisplay(masterByte);
        resetBitDisplay();
        updateStatus("传输中...");
        currentState = 'TRANSFER';

        // Function to determine sampling edge based on SPI mode
        const isSamplingEdge = (prevSclkVal, curSclkVal) => {
            // If CPHA=0, sample on first edge (rising if CPOL=0, falling if CPOL=1)
            // If CPHA=1, sample on second edge (falling if CPOL=0, rising if CPOL=1)
            if (cpha === 0) {
                // Sample on first edge (transition from idle)
                return prevSclkVal !== curSclkVal && curSclkVal !== cpol;
            } else {
                // Sample on second edge (transition back to idle)
                return prevSclkVal !== curSclkVal && curSclkVal === cpol;
            }
        };

        // Generate steps for each bit of the data transfer
        for (let i = dataBits - 1; i >= 0; i--) {
            const mosiBit = (masterByte >> i) & 1; // 主机发送位
            const misoBit = (slaveByte >> i) & 1;  // 从机发送位
            
            if (cpha === 0) {
                // Mode 0/2: Data is valid on leading clock edge
                // First set data on MOSI and MISO
                addStep(`位 ${i}: 设置MOSI=${mosiBit}, MISO=${misoBit}`, false, cpol, mosiBit, misoBit, 1);
                
                // Then toggle SCLK for the first time (this is the sampling edge)
                addStep(`位 ${i}: 第一个时钟沿 (采样)`, false, !cpol, mosiBit, misoBit, 1, null, i, i);
                
                // Then toggle SCLK back (this is the setup edge for the next bit)
                addStep(`位 ${i}: 第二个时钟沿 (准备下一位)`, false, cpol, mosiBit, misoBit, 1);
            } else {
                // Mode 1/3: Data is valid on trailing clock edge
                // First toggle SCLK (this is the setup edge)
                addStep(`位 ${i}: 第一个时钟沿 (准备)`, false, !cpol, mosiBit, misoBit, 1);
                
                // Then toggle SCLK back (this is the sampling edge)
                addStep(`位 ${i}: 第二个时钟沿 (采样)`, false, cpol, mosiBit, misoBit, 1, null, i, i);
                
                // Add a short delay before the next bit if not the last bit
                if (i > 0) {
                    addStep(`位 ${i}: 准备下一位`, false, cpol, mosiBit, misoBit, 1);
                }
            }
        }

        // 4. SS goes high to end transaction
        addStep("SS 拉高, 结束传输", true, cpol, prevMosi, prevMiso, 2, "End");
        currentState = 'IDLE';
        updateStatus("传输完成");
        clearBitHighlights();

        // 5. Final Idle state
        addStep("总线再次空闲", true, cpol, false, false, 3, "Idle");
    }

    // --- Simulation Execution ---

    function runNextStep() {
        if (!simulationRunning || currentStep >= simulationSteps.length) {
            if (simulationRunning) { // Finished naturally
                log("--- 模拟完成 ---");
                updateStatus("空闲");
                startButton.textContent = "开始传输";
                startButton.classList.remove("stop-button");
                startButton.disabled = false;
                simulationRunning = false;
            }
            return;
        }

        const step = simulationSteps[currentStep];
        log(`[步骤 ${currentStep + 1}] ${step.desc}`);
        step.action(); // Execute the current step's logic

        currentStep++;

        // Check if simulation should continue
        if (simulationRunning) {
            const delay = parseInt(speedInput.value) || 150;
            simulationTimeout = setTimeout(runNextStep, delay);
        } else { // Stopped manually
            log("--- 模拟已停止 ---");
            updateStatus("已手动停止");
            startButton.textContent = "开始传输";
            startButton.classList.remove("stop-button");
            startButton.disabled = false;
        }
    }

    // --- Event Listeners ---

    // 处理时钟极性（CPOL）选择
    cpolRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                cpol = parseInt(e.target.value);
                // 更新初始时钟状态
                setSignalDiv(sclkDiv, cpol);
            }
        });
    });

    // 处理时钟相位（CPHA）选择
    cphaRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                cpha = parseInt(e.target.value);
            }
        });
    });

    startButton.addEventListener('click', () => {
        if (simulationRunning) { // Act as a Stop button
            clearTimeout(simulationTimeout);
            simulationRunning = false; // Flag to stop the loop in runNextStep
            return;
        }
        
        // 解析输入的十六进制值
        const masterVal = parseHexInput(masterDataInput, dataBits);
        const slaveVal = parseHexInput(slaveDataInput, dataBits);

        if (masterVal === null || slaveVal === null) {
            return;
        }

        masterByte = masterVal;
        slaveByte = slaveVal;

        // Reset UI and state
        logOutput.value = ''; // Clear log first
        setupCanvas();      // Setup canvas dimensions and initial state
        currentStep = 0;    // Reset step counter
        
        // Set initial signal states based on SPI mode
        setSignalDiv(ssDiv, true);     // SS high (inactive)
        setSignalDiv(sclkDiv, cpol);   // SCLK depends on CPOL
        setSignalDiv(mosiDiv, false);  // MOSI initial state
        setSignalDiv(misoDiv, false);  // MISO initial state
        
        updateCurrentByteDisplay(null);
        clearBitHighlights();

        log(`模拟开始: 主机发送数据 ${formatHex(masterByte)}, 从机发送数据 ${formatHex(slaveByte)}`);
        log(`SPI设置: CPOL=${cpol}, CPHA=${cpha} (模式 ${(cpol<<1)|cpha})\n---`);

        buildSimulationSteps(); // Define all drawing actions

        simulationRunning = true;
        startButton.textContent = "停止传输";
        startButton.classList.add("stop-button");
        startButton.disabled = false; // Keep enabled to allow stopping
        updateStatus("运行中...");
        runNextStep(); // Start the first step
    });

    // Initialize on load
    setupCanvas(); // Draw initial empty canvas state
    updateStatus("空闲");
    
    // Set initial signal states
    setSignalDiv(ssDiv, true);     // SS high (inactive)
    setSignalDiv(sclkDiv, false);  // SCLK low (CPOL=0 default)
    setSignalDiv(mosiDiv, false);  // MOSI initial state
    setSignalDiv(misoDiv, false);  // MISO initial state
});