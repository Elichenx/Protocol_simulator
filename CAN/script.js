document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const formatRadios = document.querySelectorAll('input[name="canFormat"]');
    const frameTypeRadios = document.querySelectorAll('input[name="frameType"]');
    const messageIdInput = document.getElementById('messageId');
    const dataLengthSelect = document.getElementById('dataLength');
    const dataBytesInput = document.getElementById('dataBytes');
    const bitRateSelect = document.getElementById('bitRate');
    const startButton = document.getElementById('startButton');
    const speedInput = document.getElementById('speed');
    const statusSpan = document.getElementById('status');
    const canHighDiv = document.getElementById('canHigh');
    const canLowDiv = document.getElementById('canLow');
    const differentialDiv = document.getElementById('differential');
    const currentFrameStatusSpan = document.getElementById('currentFrameStatus');
    const logOutput = document.getElementById('logOutput');
    const currentBitElement = document.getElementById('currentBit');
    const bitTypeElement = document.getElementById('bitType');
    const bitExplanationElement = document.getElementById('bitExplanation');
    
    // Canvas Elements
    const canvasContainer = document.getElementById('sequenceDiagramContainer');
    const canvas = document.getElementById('sequenceCanvas');
    const ctx = canvas.getContext('2d');
    
    // Frame Structure Element
    const frameStructure = document.getElementById('frameStructure');

    // Simulation State
    let simulationRunning = false;
    let simulationTimeout = null;
    let currentState = 'IDLE';
    let currentStep = 0;
    let messageId = 0;
    let dataLength = 8;
    let dataBytes = [];
    let simulationSteps = [];
    let isStandardFormat = true;
    let isDataFrame = true;

    // Canvas Drawing Constants & State
    const H_STEP = 12;        // Horizontal pixels per bit step
    const V_SPACING = 40;     // Vertical space between signal lines
    const V_OFFSET_TOP = 30;  // Top padding inside canvas
    const CAN_HIGH_Y = V_OFFSET_TOP;
    const CAN_LOW_Y = V_OFFSET_TOP + V_SPACING;
    const DIFF_Y = V_OFFSET_TOP + V_SPACING * 2;
    const RECESSSIVE_LEVEL_OFFSET = 5;  // Y offset for recessive level (relative to line Y)
    const DOMINANT_LEVEL_OFFSET = 20;   // Y offset for dominant level
    const LABEL_Y = DIFF_Y + V_SPACING; // Y position for labels

    const COLOR_CAN_HIGH = '#007bff';  // Blue
    const COLOR_CAN_LOW = '#fd7e14';   // Orange
    const COLOR_DIFF = '#6610f2';      // Purple
    const COLOR_LABEL = '#6c757d';     // Gray
    const COLOR_BIT_LABEL = '#888';
    const COLOR_DOMINANT_INDICATOR = getComputedStyle(document.documentElement).getPropertyValue('--signal-dominant-bg').trim();
    const COLOR_RECESSIVE_INDICATOR = getComputedStyle(document.documentElement).getPropertyValue('--signal-recessive-bg').trim();

    let currentX = 0;           // Current horizontal drawing position on canvas
    let totalStepsEstimate = 0; // Used to estimate canvas width

    // --- Helper Functions ---

    function log(message) {
        logOutput.value += message + '\n';
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    function setSignalDiv(div, state) {
        const isRecessive = state === 'recessive';
        div.classList.toggle('recessive', isRecessive);
        div.classList.toggle('dominant', !isRecessive);
        
        const displayText = div.id === 'canHigh' ? 'CAN_H (高电平线)' :
                           div.id === 'canLow' ? 'CAN_L (低电平线)' : 
                           '差分信号 (CAN_H - CAN_L)';
                           
        div.textContent = `${displayText} ${isRecessive ? '(隐性)' : '(显性)'}`;
        return isRecessive; // Return true if recessive, false if dominant
    }

    function updateStatus(text) {
        statusSpan.textContent = `状态: ${text}`;
    }

    function updateFrameStatus(text) {
        currentFrameStatusSpan.textContent = text;
    }

    function updateBitDisplay(type, explanation, isDominant) {
        // Update bit type and explanation
        bitTypeElement.textContent = type;
        bitExplanationElement.textContent = explanation;
        
        // Update bit visual state
        currentBitElement.classList.add('active');
        currentBitElement.classList.toggle('recessive', !isDominant);
        currentBitElement.classList.toggle('dominant', isDominant);
    }

    function resetBitDisplay() {
        bitTypeElement.textContent = '--';
        bitExplanationElement.textContent = '';
        currentBitElement.classList.remove('active', 'recessive', 'dominant');
    }

    function parseHexInput(inputElement, maxLength) {
        const hexValue = inputElement.value.trim().toUpperCase();
        inputElement.value = hexValue; // Ensure uppercase display
        
        if (!/^[0-9A-F]+$/.test(hexValue)) {
            alert(`无效的十六进制输入: ${hexValue} (只允许 0-9, A-F)`);
            return null;
        }
        
        if (maxLength && hexValue.length > maxLength) {
            alert(`输入过长: ${hexValue} 超过了 ${maxLength} 个十六进制字符`);
            return null;
        }
        
        return hexValue;
    }

    function formatHex(value, width = 2) {
        if (typeof value === 'number') {
            return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
        } else {
            // For string hex values, ensure they have "0x" prefix
            return value.startsWith('0x') ? value.toUpperCase() : `0x${value.toUpperCase()}`;
        }
    }

    function hexToBytes(hexString) {
        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            const byte = parseInt(hexString.substr(i, 2), 16);
            bytes.push(byte);
        }
        return bytes;
    }

    function hexToBits(hexString) {
        const bits = [];
        for (let i = 0; i < hexString.length; i++) {
            const nibble = parseInt(hexString[i], 16);
            for (let j = 3; j >= 0; j--) {
                bits.push((nibble >> j) & 0x1);
            }
        }
        return bits;
    }

    // --- Canvas Drawing Functions ---

    function setupCanvas() {
        // Estimate total steps for canvas width
        let estimatedBits = 0;
        
        // Count approximate bits in a CAN frame
        // SOF (1) + ID (11 or 29) + Control (RTR+IDE+r0+DLC = 6) + Data (0-64) + CRC (15+1) + ACK (2) + EOF (7) + IFS (3)
        estimatedBits = 1 + (isStandardFormat ? 11 : 29) + 6 + (dataLength * 8) + 16 + 2 + 7 + 3;
        
        totalStepsEstimate = estimatedBits + 10; // Add some padding
        
        const canvasWidth = totalStepsEstimate * H_STEP + 80; // Add padding
        const canvasHeight = LABEL_Y + 30; // Height based on label position + padding

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
        ctx.fillText('CAN_H', H_STEP * 2 - 5, CAN_HIGH_Y + (DOMINANT_LEVEL_OFFSET + RECESSSIVE_LEVEL_OFFSET) / 2);
        ctx.fillText('CAN_L', H_STEP * 2 - 5, CAN_LOW_Y + (DOMINANT_LEVEL_OFFSET + RECESSSIVE_LEVEL_OFFSET) / 2);
        ctx.fillText('Diff', H_STEP * 2 - 5, DIFF_Y + (DOMINANT_LEVEL_OFFSET + RECESSSIVE_LEVEL_OFFSET) / 2);
        ctx.textAlign = 'left'; // Reset alignment

        currentX = H_STEP * 2; // Starting X position after labels
    }

    function drawLineSegment(yPos, startX, endX, state) {
        const y = yPos + (state === 'recessive' ? RECESSSIVE_LEVEL_OFFSET : DOMINANT_LEVEL_OFFSET);
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }

    function drawVerticalLine(xPos, startY, endY) {
        ctx.moveTo(xPos, startY);
        ctx.lineTo(xPos, endY);
    }

    function drawStep(canHState, canLState, diffState, durationSteps = 1) {
        const startX = currentX;
        const endX = currentX + durationSteps * H_STEP;

        // Draw CAN_H segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_CAN_HIGH;
        drawLineSegment(CAN_HIGH_Y, startX, endX, canHState);
        ctx.stroke();

        // Draw CAN_L segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_CAN_LOW;
        drawLineSegment(CAN_LOW_Y, startX, endX, canLState);
        ctx.stroke();

        // Draw Differential segment
        ctx.beginPath();
        ctx.strokeStyle = COLOR_DIFF;
        drawLineSegment(DIFF_Y, startX, endX, diffState);
        ctx.stroke();

        currentX = endX; // Move drawing cursor
        canvasContainer.scrollLeft = Math.max(0, currentX - canvasContainer.clientWidth + 50); // Auto scroll
    }

    // Draws vertical edges when a signal changes state *at* a specific X coordinate
    function drawSignalChangeEdge(xPos, signalY, oldState, newState, color) {
        if (oldState !== newState) {
            const y1 = signalY + (oldState === 'recessive' ? RECESSSIVE_LEVEL_OFFSET : DOMINANT_LEVEL_OFFSET);
            const y2 = signalY + (newState === 'recessive' ? RECESSSIVE_LEVEL_OFFSET : DOMINANT_LEVEL_OFFSET);
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

    function drawBitLabel(text, xPos, yPos = CAN_HIGH_Y - 15, color = COLOR_BIT_LABEL, align = 'center') {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.font = '10px var(--font-family)'; // Smaller font for bit labels
        ctx.fillText(text, xPos, yPos);
        ctx.font = '11px var(--font-family)'; // Reset font
        ctx.textAlign = 'left'; // Reset alignment
    }

    // --- Frame Structure Visualization ---

    function buildFrameStructureVisualization() {
        // Clear existing frame structure
        frameStructure.innerHTML = '';
        
        // Create field elements based on CAN frame structure
        const fields = [];
        
        // SOF field
        fields.push({
            name: 'SOF',
            bits: '1',
            value: '0',
            class: 'field-sof'
        });
        
        // ID field
        if (isStandardFormat) {
            fields.push({
                name: '标识符',
                bits: '11',
                value: formatHex(messageId, messageId.toString(16).length),
                class: 'field-id'
            });
        } else {
            // Extended format has base ID (11 bits) and extended ID (18 bits)
            fields.push({
                name: '基础标识符',
                bits: '11',
                value: formatHex((messageId >> 18) & 0x7FF, 3),
                class: 'field-id'
            });
            
            fields.push({
                name: 'SRR',
                bits: '1',
                value: 'r',
                class: 'field-rtr'
            });
            
            fields.push({
                name: 'IDE',
                bits: '1',
                value: '1',
                class: 'field-ide'
            });
            
            fields.push({
                name: '扩展标识符',
                bits: '18',
                value: formatHex(messageId & 0x3FFFF, 5),
                class: 'field-id'
            });
        }
        
        // RTR bit (for standard format)
        if (isStandardFormat) {
            fields.push({
                name: 'RTR',
                bits: '1',
                value: isDataFrame ? '0' : '1',
                class: 'field-rtr'
            });
            
            fields.push({
                name: 'IDE',
                bits: '1',
                value: '0',
                class: 'field-ide'
            });
        }
        
        // Remote Frame bit (for extended format) or r0 reserved bit
        fields.push({
            name: isStandardFormat ? 'r0' : 'RTR',
            bits: '1',
            value: isDataFrame ? '0' : '1',
            class: 'field-r0'
        });
        
        // Extended format has additional r1 reserved bit
        if (!isStandardFormat) {
            fields.push({
                name: 'r1',
                bits: '1',
                value: '0',
                class: 'field-r0'
            });
        }
        
        // DLC field
        fields.push({
            name: 'DLC',
            bits: '4',
            value: dataLength.toString(),
            class: 'field-dlc'
        });
        
        // Data field (if data frame)
        if (isDataFrame && dataLength > 0) {
            // Convert data bytes to a string representation
            const dataStr = dataBytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
            
            fields.push({
                name: '数据',
                bits: `${dataLength * 8}`,
                value: formatHex(dataStr),
                class: 'field-data'
            });
        }
        
        // CRC field
        fields.push({
            name: 'CRC',
            bits: '15',
            value: '(计算值)',
            class: 'field-crc'
        });
        
        fields.push({
            name: 'CRC 界定符',
            bits: '1',
            value: '1',
            class: 'field-crc'
        });
        
        // ACK field
        fields.push({
            name: 'ACK',
            bits: '1',
            value: '0',
            class: 'field-ack'
        });
        
        fields.push({
            name: 'ACK 界定符',
            bits: '1',
            value: '1',
            class: 'field-ack'
        });
        
        // EOF field
        fields.push({
            name: 'EOF',
            bits: '7',
            value: '1111111',
            class: 'field-eof'
        });
        
        // IFS field
        fields.push({
            name: 'IFS',
            bits: '3',
            value: '111',
            class: 'field-ifs'
        });
        
        // Render fields
        fields.forEach(field => {
            const fieldElement = document.createElement('div');
            fieldElement.className = `frame-field ${field.class}`;
            
            const nameElement = document.createElement('div');
            nameElement.className = 'field-name';
            nameElement.textContent = field.name;
            
            const bitsElement = document.createElement('div');
            bitsElement.className = 'field-bits';
            bitsElement.textContent = `${field.bits} 位`;
            
            const valueElement = document.createElement('div');
            valueElement.className = 'field-value';
            valueElement.textContent = field.value;
            
            fieldElement.appendChild(nameElement);
            fieldElement.appendChild(bitsElement);
            fieldElement.appendChild(valueElement);
            
            frameStructure.appendChild(fieldElement);
        });
    }

    // --- Simulation Step Functions ---

    function buildSimulationSteps() {
        simulationSteps = [];
        
        let prevCanH = 'recessive';    // Initial idle state (recessive)
        let prevCanL = 'recessive';    // Initial idle state (recessive)
        let prevDiff = 'recessive';    // Initial idle state (recessive)

        // Helper for adding simulation steps
        const addStep = (desc, canH, canL, diff, duration = 1, label = null, bitValue = null, bitType = null, bitExplanation = null) => {
            simulationSteps.push({
                desc: desc,
                action: () => {
                    // Update signal visualization
                    const currentCanH = setSignalDiv(canHighDiv, canH);
                    const currentCanL = setSignalDiv(canLowDiv, canL);
                    const currentDiff = setSignalDiv(differentialDiv, diff);
                    const startDrawX = currentX; // X before drawing this step

                    // Draw edges *before* drawing the horizontal segment
                    drawSignalChangeEdge(startDrawX, CAN_HIGH_Y, prevCanH, canH, COLOR_CAN_HIGH);
                    drawSignalChangeEdge(startDrawX, CAN_LOW_Y, prevCanL, canL, COLOR_CAN_LOW);
                    drawSignalChangeEdge(startDrawX, DIFF_Y, prevDiff, diff, COLOR_DIFF);

                    // Draw the horizontal lines for this step's duration
                    drawStep(canH, canL, diff, duration);

                    // Draw labels if provided
                    if (label) {
                        drawLabel(label, startDrawX + (duration * H_STEP) / 2);
                    }
                    
                    if (bitValue !== null) {
                        drawBitLabel(bitValue.toString(), startDrawX + (duration * H_STEP) / 2);
                    }
                    
                    // Update bit display if requested
                    if (bitType !== null) {
                        const isDominant = diff === 'dominant';
                        updateBitDisplay(bitType, bitExplanation || '', isDominant);
                    }

                    // Update previous state for next edge drawing
                    prevCanH = canH;
                    prevCanL = canL;
                    prevDiff = diff;
                }
            });
        };

        // 1. Initial Idle State
        addStep(
            "总线空闲 (隐性状态)", 
            'recessive', 'recessive', 'recessive', 
            3, "总线空闲"
        );

        // 2. Start of Frame (SOF)
        addStep(
            "SOF (帧起始位) - 显性位", 
            'dominant', 'dominant', 'dominant', 
            1, null, '0', 'SOF', '帧起始位'
        );
        updateFrameStatus("传输起始");
        updateStatus("传输中...");
        currentState = 'TRANSFER';

        // 3. Identifier Field - Standard (11 bits) or Extended (29 bits)
        // For standard format, 11 bits ID
        if (isStandardFormat) {
            for (let i = 10; i >= 0; i--) {
                const bit = (messageId >> i) & 0x1;
                const bitState = bit === 0 ? 'dominant' : 'recessive';
                addStep(
                    `标识符位 ${10-i} [${bit}]`, 
                    bitState, bitState, bitState, 
                    1, null, bit, 'ID', `标识符位 ${10-i}`
                );
            }
            
            // RTR bit
            const rtrBit = isDataFrame ? 0 : 1;
            const rtrState = rtrBit === 0 ? 'dominant' : 'recessive';
            addStep(
                `RTR位 [${rtrBit}] - ${isDataFrame ? '数据帧' : '远程帧'}`, 
                rtrState, rtrState, rtrState, 
                1, null, rtrBit, 'RTR', `远程传输请求: ${isDataFrame ? '数据帧' : '远程帧'}`
            );
            
            // IDE bit (always dominant for standard format)
            addStep(
                "IDE位 [0] - 标准格式", 
                'dominant', 'dominant', 'dominant', 
                1, null, '0', 'IDE', '标识符扩展位: 标准格式'
            );
            
            // r0 reserved bit (always dominant)
            addStep(
                "r0位 [0] - 保留位", 
                'dominant', 'dominant', 'dominant', 
                1, null, '0', 'r0', '保留位'
            );
        }
        // For extended format, 29 bits ID (11 + 18)
        else {
            // Base ID (11 bits)
            const baseId = (messageId >> 18) & 0x7FF;
            for (let i = 10; i >= 0; i--) {
                const bit = (baseId >> i) & 0x1;
                const bitState = bit === 0 ? 'dominant' : 'recessive';
                addStep(
                    `基础标识符位 ${10-i} [${bit}]`, 
                    bitState, bitState, bitState, 
                    1, null, bit, 'ID', `基础标识符位 ${10-i}`
                );
            }
            
            // SRR bit (substitute remote request) - always recessive
            addStep(
                "SRR位 [1] - 替代远程请求位", 
                'recessive', 'recessive', 'recessive', 
                1, null, '1', 'SRR', '替代远程请求位'
            );
            
            // IDE bit (always recessive for extended format)
            addStep(
                "IDE位 [1] - 扩展格式", 
                'recessive', 'recessive', 'recessive', 
                1, null, '1', 'IDE', '标识符扩展位: 扩展格式'
            );
            
            // Extended ID (18 bits)
            const extId = messageId & 0x3FFFF;
            for (let i = 17; i >= 0; i--) {
                const bit = (extId >> i) & 0x1;
                const bitState = bit === 0 ? 'dominant' : 'recessive';
                addStep(
                    `扩展标识符位 ${17-i} [${bit}]`, 
                    bitState, bitState, bitState, 
                    1, null, bit, 'ID', `扩展标识符位 ${17-i}`
                );
            }
            
            // RTR bit for extended format
            const rtrBit = isDataFrame ? 0 : 1;
            const rtrState = rtrBit === 0 ? 'dominant' : 'recessive';
            addStep(
                `RTR位 [${rtrBit}] - ${isDataFrame ? '数据帧' : '远程帧'}`, 
                rtrState, rtrState, rtrState, 
                1, null, rtrBit, 'RTR', `远程传输请求: ${isDataFrame ? '数据帧' : '远程帧'}`
            );
            
            // r1 reserved bit (always dominant)
            addStep(
                "r1位 [0] - 保留位", 
                'dominant', 'dominant', 'dominant', 
                1, null, '0', 'r1', '保留位'
            );
        }
        
        // 4. DLC (Data Length Code) - 4 bits
        for (let i = 3; i >= 0; i--) {
            const bit = (dataLength >> i) & 0x1;
            const bitState = bit === 0 ? 'dominant' : 'recessive';
            addStep(
                `DLC位 ${3-i} [${bit}]`, 
                bitState, bitState, bitState, 
                1, null, bit, 'DLC', `数据长度码位 ${3-i}`
            );
        }
        
        // 5. Data Field (0 to 8 bytes)
        if (isDataFrame && dataLength > 0) {
            updateFrameStatus("传输数据");
            for (let byte = 0; byte < dataLength; byte++) {
                for (let bit = 7; bit >= 0; bit--) {
                    const bitValue = (dataBytes[byte] >> bit) & 0x1;
                    const bitState = bitValue === 0 ? 'dominant' : 'recessive';
                    addStep(
                        `数据字节 ${byte} 位 ${7-bit} [${bitValue}]`, 
                        bitState, bitState, bitState, 
                        1, null, bitValue, 'DATA', `数据字节 ${byte+1}/${dataLength} 位 ${7-bit}`
                    );
                }
            }
        }
        
        // 6. CRC Field (15 bits) + delimiter (1 bit)
        // For simplicity, we'll use a fixed CRC value. In a real implementation,
        // this would be calculated based on the frame contents.
        updateFrameStatus("CRC校验");
        const dummyCRC = 0b101010101010101; // Dummy CRC for visualization
        for (let i = 14; i >= 0; i--) {
            const bit = (dummyCRC >> i) & 0x1;
            const bitState = bit === 0 ? 'dominant' : 'recessive';
            addStep(
                `CRC位 ${14-i} [${bit}]`, 
                bitState, bitState, bitState, 
                1, null, bit, 'CRC', `CRC校验位 ${14-i}`
            );
        }
        
        // CRC Delimiter (always recessive)
        addStep(
            "CRC界定符 [1]", 
            'recessive', 'recessive', 'recessive', 
            1, null, '1', 'CRC_DELIM', 'CRC界定符'
        );
        
        // 7. ACK Field (1 bit) + delimiter (1 bit)
        updateFrameStatus("确认");
        // ACK Slot (dominant when acknowledged)
        addStep(
            "ACK槽 [0] - 接收成功", 
            'dominant', 'dominant', 'dominant', 
            1, null, '0', 'ACK', 'ACK确认槽'
        );
        
        // ACK Delimiter (always recessive)
        addStep(
            "ACK界定符 [1]", 
            'recessive', 'recessive', 'recessive', 
            1, null, '1', 'ACK_DELIM', 'ACK界定符'
        );
        
        // 8. End of Frame (EOF) - 7 recessive bits
        updateFrameStatus("帧结束");
        for (let i = 0; i < 7; i++) {
            addStep(
                `EOF位 ${i} [1]`, 
                'recessive', 'recessive', 'recessive', 
                1, null, '1', 'EOF', `帧结束位 ${i+1}/7`
            );
        }
        
        // 9. Interframe Space (IFS) - 3 recessive bits
        for (let i = 0; i < 3; i++) {
            addStep(
                `IFS位 ${i} [1]`, 
                'recessive', 'recessive', 'recessive', 
                1, null, '1', 'IFS', `帧间隔位 ${i+1}/3`
            );
        }
        
        // 10. Final Idle state
        addStep(
            "总线再次空闲 (隐性状态)", 
            'recessive', 'recessive', 'recessive', 
            3, "总线空闲"
        );
        currentState = 'IDLE';
        updateStatus("传输完成");
        updateFrameStatus("已完成");
        resetBitDisplay();
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

    // Handle message format selection (standard/extended)
    formatRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                isStandardFormat = e.target.value === 'standard';
                
                // Update max length of message ID input based on format
                messageIdInput.maxLength = isStandardFormat ? 3 : 8;
                
                // Validate current message ID against new format
                if (isStandardFormat && parseInt(messageIdInput.value, 16) > 0x7FF) {
                    // Standard format can only have 11-bit IDs (0x000 to 0x7FF)
                    messageIdInput.value = '7FF';
                    alert('标准格式CAN帧的ID不能超过0x7FF (11位)。ID已调整为最大值。');
                }
            }
        });
    });

    // Handle frame type selection (data/remote)
    frameTypeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                isDataFrame = e.target.value === 'data';
                
                // Toggle visibility of data input field based on frame type
                const dataField = document.querySelector('.data-field');
                dataField.style.display = isDataFrame ? 'flex' : 'none';
            }
        });
    });

    // Handle data length selection
    dataLengthSelect.addEventListener('change', (e) => {
        dataLength = parseInt(e.target.value);
        
        // Update max length of data bytes input based on data length
        dataBytesInput.maxLength = dataLength * 2;
        
        // Validate current data bytes against new length
        const currentData = dataBytesInput.value;
        if (currentData.length > dataLength * 2) {
            dataBytesInput.value = currentData.substring(0, dataLength * 2);
            alert(`数据长度已更改为 ${dataLength} 字节。数据已被截断以匹配新长度。`);
        }
    });

    startButton.addEventListener('click', () => {
        if (simulationRunning) { // Act as a Stop button
            clearTimeout(simulationTimeout);
            simulationRunning = false; // Flag to stop the loop in runNextStep
            return;
        }

        // Parse message ID
        const idMaxLength = isStandardFormat ? 3 : 8; // 3 hex chars for 11-bit ID, 8 for 29-bit ID
        const idHex = parseHexInput(messageIdInput, idMaxLength);
        if (idHex === null) return;
        
        // Validate ID range
        messageId = parseInt(idHex, 16);
        const maxId = isStandardFormat ? 0x7FF : 0x1FFFFFFF;
        if (messageId > maxId) {
            alert(`报文ID超出范围: 0x${idHex} 超过了 ${isStandardFormat ? '标准' : '扩展'}帧最大值 0x${maxId.toString(16).toUpperCase()}`);
            return;
        }
        
        // Get data length
        dataLength = parseInt(dataLengthSelect.value);
        
        // Parse data bytes
        if (isDataFrame && dataLength > 0) {
            const dataHex = parseHexInput(dataBytesInput, dataLength * 2);
            if (dataHex === null) return;
            
            // Pad data if needed
            const paddedData = dataHex.padEnd(dataLength * 2, '0');
            dataBytesInput.value = paddedData.toUpperCase();
            
            // Convert hex string to byte array
            dataBytes = hexToBytes(paddedData);
        } else {
            dataBytes = [];
        }

        // Reset UI and state
        logOutput.value = ''; // Clear log first
        setupCanvas();      // Setup canvas dimensions and initial state
        currentStep = 0;    // Reset step counter
        
        // Set initial signal states
        setSignalDiv(canHighDiv, 'recessive');
        setSignalDiv(canLowDiv, 'recessive');
        setSignalDiv(differentialDiv, 'recessive');
        
        updateFrameStatus("准备中");
        resetBitDisplay();
        buildFrameStructureVisualization(); // Update the frame structure visualization

        // Start simulation
        log(`模拟开始: ${isStandardFormat ? '标准' : '扩展'}格式 ${isDataFrame ? '数据' : '远程'}帧`);
        log(`报文ID: ${formatHex(messageId)}, 数据长度: ${dataLength} 字节${isDataFrame ? ', 数据: ' + formatHex(dataBytesInput.value) : ''}`);
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
    updateFrameStatus("--");
    
    // Set initial signal states
    setSignalDiv(canHighDiv, 'recessive');
    setSignalDiv(canLowDiv, 'recessive');
    setSignalDiv(differentialDiv, 'recessive');
    
    // Initial frame structure visualization
    buildFrameStructureVisualization();
});