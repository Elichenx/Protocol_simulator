document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const operationTypeRadios = document.querySelectorAll('input[name="operationType"]');
    const addressInput = document.getElementById('address');
    const dataInput = document.getElementById('data');
    const responseDataInput = document.getElementById('responseData');
    const ackTypeSelect = document.getElementById('ackType');
    const startButton = document.getElementById('startButton');
    const speedInput = document.getElementById('speed');
    const statusSpan = document.getElementById('status');
    const sclDiv = document.getElementById('scl');
    const sdaDiv = document.getElementById('sda');
    const currentByteSpan = document.getElementById('currentByte');
    const logOutput = document.getElementById('logOutput');
    const bitElements = {
        b7: document.getElementById('bit7'), b6: document.getElementById('bit6'),
        b5: document.getElementById('bit5'), b4: document.getElementById('bit4'),
        b3: document.getElementById('bit3'), b2: document.getElementById('bit2'),
        b1: document.getElementById('bit1'), b0: document.getElementById('bit0'),
        ack: document.getElementById('bitACK'),
    };
    // 获取读写操作相关字段
    const writeFields = document.querySelectorAll('.write-field');
    const readFields = document.querySelectorAll('.read-field');
    
    // Canvas Elements
    const canvasContainer = document.getElementById('sequenceDiagramContainer');
    const canvas = document.getElementById('sequenceCanvas');
    const ctx = canvas.getContext('2d');

    // Simulation State
    let simulationRunning = false;
    let simulationTimeout = null;
    let currentState = 'IDLE';
    let currentStep = 0;
    let addressByte = 0;
    let dataByte = 0;
    let responseDataByte = 0;
    let isReadOperation = false;
    let useMasterAck = false;
    let simulationSteps = [];

    // Canvas Drawing Constants & State
    const H_STEP = 15;       // Horizontal pixels per clock phase (low or high)
    const V_SPACING = 45;    // Vertical space between SCL/SDA lines
    const V_OFFSET_TOP = 30; // Top padding inside canvas
    const SCL_Y = V_OFFSET_TOP;
    const SDA_Y = V_OFFSET_TOP + V_SPACING;
    const HIGH_LEVEL_OFFSET = 0; // Y offset for high level (relative to SCL_Y/SDA_Y)
    const LOW_LEVEL_OFFSET = 15; // Y offset for low level
    const LABEL_Y = SDA_Y + V_SPACING / 1.5; // Y position for labels like Start, Addr etc.
    const BIT_LABEL_Y = SCL_Y - 15; // Y position for bit number labels

    const COLOR_SCL = '#007bff'; // Blue
    const COLOR_SDA = '#17a2b8'; // Teal
    const COLOR_LABEL = '#6c757d'; // Gray
    const COLOR_BIT_LABEL = '#888';
    const COLOR_HIGH_INDICATOR = getComputedStyle(document.documentElement).getPropertyValue('--signal-high-bg').trim(); // Get from CSS vars
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
        div.textContent = `${div.id.toUpperCase()} (${isHigh ? 'High' : 'Low'})`;
        return isHigh; // Return boolean state
    }

    function updateStatus(text) {
        statusSpan.textContent = `状态: ${text}`;
    }

    function updateCurrentByteDisplay(byte) {
        if (byte === null) {
            currentByteSpan.textContent = '--';
            clearBitHighlights();
        } else {
            currentByteSpan.textContent = `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
        }
    }

    function clearBitHighlights(clearAck = true) {
        Object.values(bitElements).forEach(el => {
            if (!el) return;
            if (!clearAck && el.classList.contains('ack')) return;
            el.classList.remove('active', 'high', 'low', 'ack-received', 'nack-received');
        });
    }

    function highlightBit(bitIndex, level) {
        clearBitHighlights(false);
        const bitId = bitIndex === -1 ? 'ack' : `b${bitIndex}`;
        const bitEl = bitElements[bitId];
        if (bitEl) {
            const isHigh = level === 1 || level === true;
            bitEl.classList.add('active');
            bitEl.classList.toggle('high', isHigh);
            bitEl.classList.toggle('low', !isHigh);
            if (bitId === 'ack') {
                bitEl.classList.toggle('ack-received', !isHigh); // ACK is low
                bitEl.classList.toggle('nack-received', isHigh); // NACK is high
            }
        }
    }

    function resetBitDisplayByte() {
        Object.values(bitElements).forEach(el => {
            el.classList.remove('active', 'high', 'low', 'ack-received', 'nack-received');
        });
    }

    function parseHexInput(inputElement, bits) {
        const hexValue = inputElement.value.trim().toUpperCase();
        inputElement.value = hexValue; // Ensure uppercase display
        const maxValue = (1 << bits) - 1;
        if (!/^[0-9A-F]+$/.test(hexValue)) {
            alert(`无效的十六进制输入: ${hexValue} (只允许 0-9, A-F)`);
            return null;
        }
        const value = parseInt(hexValue, 16);
        if (isNaN(value) || value < 0 || value > maxValue) {
             alert(`无效的 ${bits}-bit 十六进制值: 0x${hexValue}. 范围应在 0x00 到 0x${maxValue.toString(16).toUpperCase()} 之间.`);
             return null;
        }
        return value;
    }

    function formatHex(byte) {
        return `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    // --- Canvas Drawing Functions ---

    function setupCanvas() {
        // Estimate total steps: Start(2) + Addr(8*2) + Ack(2) + Data(8*2) + Ack(2) + Stop(2) + Idle(few extra)
        totalStepsEstimate = (1 + 8 + 1 + 8 + 1 + 1) * 2 + 10; // ~50 steps * H_STEP
        const canvasWidth = totalStepsEstimate * H_STEP + 50; // Add some padding
        const canvasHeight = LABEL_Y + 30; // Height based on label position

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
        ctx.fillText('SCL', H_STEP * 2 - 5, SCL_Y + LOW_LEVEL_OFFSET / 2);
        ctx.fillText('SDA', H_STEP * 2 - 5, SDA_Y + LOW_LEVEL_OFFSET / 2);
        ctx.textAlign = 'left'; // Reset alignment

        currentX = H_STEP * 2; // Starting X position after labels
        
        // 重置标签跟踪
        lastLabelX = 0;
        lastLabelWidth = 0;
    }

    // 添加变量用于跟踪上一个标签的位置和宽度
    let lastLabelX = 0;
    let lastLabelWidth = 0;
    const MIN_LABEL_SPACING = 5; // 最小标签间距（像素）

    function drawLineSegment(yPos, startX, endX, level) {
        const y = yPos + (level ? HIGH_LEVEL_OFFSET : LOW_LEVEL_OFFSET);
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }

    function drawVerticalLine(xPos, startY, endY) {
         ctx.moveTo(xPos, startY);
         ctx.lineTo(xPos, endY);
    }

    function drawStep(sclLevel, sdaLevel, durationSteps = 1, sclColor = COLOR_SCL, sdaColor = COLOR_SDA) {
        const startX = currentX;
        const endX = currentX + durationSteps * H_STEP;

        // Draw SCL segment
        ctx.beginPath();
        ctx.strokeStyle = sclColor;
        drawLineSegment(SCL_Y, startX, endX, sclLevel);
        ctx.stroke();

        // Draw SDA segment
        ctx.beginPath();
        ctx.strokeStyle = sdaColor;
        drawLineSegment(SDA_Y, startX, endX, sdaLevel);
        ctx.stroke();

        // Draw vertical transition lines *at the beginning* of the step if level changed
        // (This requires knowing the *previous* state, managed implicitly by drawing order)
        // Optional: Add vertical lines for clarity on SCL edges? (Can make it busy)

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
         // 防止标签重叠
         if (text) {
             ctx.font = '11px var(--font-family)';
             const textWidth = ctx.measureText(text).width;
             const labelLeftEdge = align === 'center' ? xPos - textWidth / 2 : xPos;
             const labelRightEdge = labelLeftEdge + textWidth;
             
             // 检查当前标签是否会与上一个标签重叠
             const lastLabelRightEdge = lastLabelX + lastLabelWidth;
             if (lastLabelRightEdge > 0 && labelLeftEdge < lastLabelRightEdge + MIN_LABEL_SPACING) {
                 // 标签会重叠，在Y轴上交错排列
                 yPos += 15; // 将当前标签下移
             }
             
             // 更新最后一个标签的位置信息
             lastLabelX = labelLeftEdge;
             lastLabelWidth = textWidth;
         }
         
         ctx.fillStyle = color;
         ctx.textAlign = align;
         ctx.fillText(text, xPos, yPos);
         ctx.textAlign = 'left'; // Reset alignment
     }
      function drawBitLabel(text, xPos, yPos = BIT_LABEL_Y, color = COLOR_BIT_LABEL, align = 'center') {
         ctx.fillStyle = color;
         ctx.textAlign = align;
         ctx.font = '10px var(--font-family)'; // Smaller font for bit labels
         ctx.fillText(text, xPos, yPos);
         ctx.font = '11px var(--font-family)'; // Reset font
         ctx.textAlign = 'left'; // Reset alignment
     }


    // --- Simulation Step Definitions (Updated for Canvas) ---

    function buildSimulationSteps() {
        simulationSteps = [];
        let prevScl = true; // Initial idle state
        let prevSda = true;

        const addStep = (desc, scl, sda, duration = 1, label = null, bitLabel = null, bitIndex = -2) => {
            simulationSteps.push({
                desc: desc,
                action: () => {
                    const currentScl = setSignalDiv(sclDiv, scl);
                    const currentSda = setSignalDiv(sdaDiv, sda);
                    const startDrawX = currentX; // X before drawing this step

                    // Draw edges *before* drawing the horizontal segment
                    drawSignalChangeEdge(startDrawX, SCL_Y, prevScl, currentScl, COLOR_SCL);
                    drawSignalChangeEdge(startDrawX, SDA_Y, prevSda, currentSda, COLOR_SDA);

                    // Draw the horizontal lines for this step's duration
                    drawStep(currentScl, currentSda, duration);

                    // Draw labels for this step
                    if (label) {
                         drawLabel(label, startDrawX + (duration * H_STEP) / 2);
                    }
                    if (bitLabel !== null) { // 0 is a valid bit label
                         drawBitLabel(bitLabel.toString(), startDrawX + (duration * H_STEP) / 2);
                    }
                    if (bitIndex > -2) { // -2 means no bit highlight update
                        highlightBit(bitIndex, currentSda); // Highlight bit based on SDA level *during SCL high* usually
                    }

                    // Update previous state for next edge drawing
                    prevScl = currentScl;
                    prevSda = currentSda;
                }
            });
        };

        // 1. Initial Idle State (draw before loop starts)
        addStep("总线空闲", true, true, 3, "Idle");

        // 2. Start Condition
        addStep("Start: SDA Low (SCL High)", true, false, 1, "Start");
        currentState = 'ADDR';
        updateCurrentByteDisplay(addressByte);
        resetBitDisplayByte();
        updateStatus("发送地址");

        // 计算实际的地址字节（添加读/写位）
        const rwBit = isReadOperation ? 1 : 0;
        const fullAddressByte = (addressByte << 1) | rwBit;

        // Function to generate steps for transmitting one byte
        const generateByteTxSteps = (byteToSend, byteTypeLabel, isMasterControl = true) => {
            addStep(`${byteTypeLabel}: 准备`, false, prevSda, 1, byteTypeLabel); // Ensure SCL low before first bit

            for (let i = 7; i >= 0; i--) {
                const bit = (byteToSend >> i) & 0x1;
                // SCL Low, Set SDA
                addStep(`${byteTypeLabel} Bit ${i}: SCL Low, SDA=${bit}`, false, bit, 1, null, null, isMasterControl ? i : -2); // Highlight starts here
                // SCL High, Clock In
                addStep(`${byteTypeLabel} Bit ${i}: SCL High`, true, bit, 1, null, i, isMasterControl ? i : -2); // Bit number label on SCL high
                if (!isMasterControl) {
                    // 如果是从机控制SDA，在SCL高时更新位显示
                    highlightBit(i, bit);
                }
            }
             // SCL Low after last bit clock
            addStep(`${byteTypeLabel}: 完成, SCL Low`, false, prevSda, 1);
            clearBitHighlights(false); // Keep ACK maybe? No, clear data bits.
        };

        // 3. Address Transmission (with R/W bit)
        generateByteTxSteps(fullAddressByte, `Addr ${formatHex(addressByte)}${isReadOperation ? '+R' : '+W'}`);
        currentState = 'ADDR_ACK';
        updateStatus("等待地址ACK");

        // 4. Address ACK Clock Pulse
        addStep("Addr ACK: Master releases SDA", false, true, 1, "ACK", null, -1); // SCL Low, Master releases SDA (goes High), highlight ACK bit (NACK state)
        addStep("Addr ACK: SCL High (Slave ACK?)", true, false, 1); // SCL High, Slave pulls SDA Low (ACK simulation)
        highlightBit(-1, 0); // Update highlight explicitly for ACK low
        addStep("Addr ACK: SCL Low (End ACK)", false, false, 1); // SCL Low

        // 5. 根据操作类型处理数据传输
        if (isReadOperation) {
            // 读操作 - 从机发送数据给主机
            currentState = 'DATA_READ';
            updateCurrentByteDisplay(responseDataByte);
            resetBitDisplayByte();
            updateStatus("接收从机数据");

            // 从机发送数据（主机接收）
            generateByteTxSteps(responseDataByte, `Data ${formatHex(responseDataByte)} ←`, false);
            currentState = 'MASTER_ACK';
            updateStatus("主机发送确认");

            // 主机发送ACK/NACK
            const masterAckLevel = useMasterAck ? 0 : 1; // ACK=0, NACK=1
            const masterAckType = useMasterAck ? "ACK" : "NACK";
            
            addStep(`Master ${masterAckType}: SCL Low, Master Controls SDA`, false, masterAckLevel, 1, "M-" + masterAckType, null, -1);
            addStep(`Master ${masterAckType}: SCL High`, true, masterAckLevel, 1);
            highlightBit(-1, masterAckLevel); // Update highlight for ACK/NACK
            addStep(`Master ${masterAckType}: SCL Low (End ACK)`, false, masterAckLevel, 1);
        } else {
            // 写操作 - 主机发送数据给从机
            currentState = 'DATA';
            updateCurrentByteDisplay(dataByte);
            resetBitDisplayByte();
            updateStatus("发送数据");

            // 主机发送数据
            generateByteTxSteps(dataByte, `Data ${formatHex(dataByte)} →`);
            currentState = 'DATA_ACK';
            updateStatus("等待数据ACK");

            // 数据ACK时钟脉冲
            addStep("Data ACK: Master releases SDA", false, true, 1, "ACK", null, -1); // SCL Low, Master releases SDA
            addStep("Data ACK: SCL High (Slave ACK?)", true, false, 1); // SCL High, Slave pulls SDA Low
            highlightBit(-1, 0); // Update highlight
            addStep("Data ACK: SCL Low (End ACK)", false, false, 1); // SCL Low
        }

        currentState = 'STOP';
        updateCurrentByteDisplay(null);
        clearBitHighlights(true);
        updateStatus("准备停止");

        // 6. Stop Condition
        // Ensure SDA is low first if not already (it is after ACK low)
        addStep("Stop: 确保SDA为低", false, false, 1);
        addStep("Stop: SCL High", true, false, 1, "Stop"); // SCL goes High while SDA is Low
        addStep("Stop: SDA High (SCL High)", true, true, 2); // SDA goes High while SCL is High
        currentState = 'IDLE';
        updateStatus("传输完成");

        // 7. Final Idle state
        addStep("总线再次空闲", true, true, 3, "Idle");
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
        step.action(); // Execute the current step's logic (updates divs and draws on canvas)

        currentStep++;

        // Check if simulation should continue
        if (simulationRunning) { // Continue if running flag is true
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

    // 操作类型切换
    operationTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            isReadOperation = radio.value === 'read';
            
            // 显示/隐藏相应的输入字段
            writeFields.forEach(elem => {
                elem.style.display = isReadOperation ? 'none' : 'flex';
            });
            
            readFields.forEach(elem => {
                elem.style.display = isReadOperation ? 'flex' : 'none';
            });
        });
    });

    startButton.addEventListener('click', () => {
        if (simulationRunning) { // Act as a Stop button
             clearTimeout(simulationTimeout);
             simulationRunning = false; // Flag to stop the loop in runNextStep
             // UI update happens in runNextStep after checking the flag
             return;
        }

        const addrVal = parseHexInput(addressInput, 7);
        if (addrVal === null) return;
        
        // 更新操作类型和相应数据
        isReadOperation = document.getElementById('read').checked;
        
        if (isReadOperation) {
            // 读操作 - 解析从机响应数据
            const respDataVal = parseHexInput(responseDataInput, 8);
            if (respDataVal === null) return;
            responseDataByte = respDataVal;
            
            // 获取主机确认类型
            useMasterAck = ackTypeSelect.value === 'ack';
        } else {
            // 写操作 - 解析发送数据
            const dataVal = parseHexInput(dataInput, 8);
            if (dataVal === null) return;
            dataByte = dataVal;
        }
        
        addressByte = addrVal;

        // Reset UI and state
        logOutput.value = ''; // Clear log first
        setupCanvas();      // Setup canvas dimensions and initial state
        currentStep = 0;    // Reset step counter
        // Reset signal divs to idle *before* building steps which assumes initial state
        setSignalDiv(sclDiv, true);
        setSignalDiv(sdaDiv, true);
        updateCurrentByteDisplay(null);
        clearBitHighlights(true);

        if (isReadOperation) {
            log(`模拟开始: I2C读操作 (主机←从机)`);
            log(`从机地址: ${formatHex(addressByte)} (${formatHex((addressByte << 1) | 1)} 带R/W), 预期接收数据: ${formatHex(responseDataByte)}`);
            log(`主机将发送: ${useMasterAck ? 'ACK (继续读取)' : 'NACK (结束读取)'}`);
        } else {
            log(`模拟开始: I2C写操作 (主机→从机)`);
            log(`从机地址: ${formatHex(addressByte)} (${formatHex(addressByte << 1)} 带R/W), 发送数据: ${formatHex(dataByte)}`);
        }
        log(`---`);

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
});