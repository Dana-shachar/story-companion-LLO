let clock;
let video;
let resultText = "";
let resultParagraph;

//UI vars
let showDigitalClock = true;
let clockCheckbox;
let capturedImage;
let clockCanvas;

// web serial connection
let port;
let writer;
let encoder = new TextEncoder();
let arduinoConnected = false;
let connectButton;

// data throttling
let lastSentData = "";
let lastSentTime = 0;
let sendInterval = 100;

let lastPositionUpdate = 0;
let positionUpdateInterval = 1000;
let lastSentAngle = -1;
let lastSentColor = "";

let reader;
let readableStreamClosed;

// ===== AI capture timing =====
let lastPhotoTime = 0;
//let captureInterval = 7000; ---> this is just to test without a button
let degradeInterval = 10000;

// min time to display score
let minScoreDisplayTime = 3000; 
let analysisInProgress = false; 
let lastScoreUpdateTime = 0;

 //==================== START OF CLASS ====================
class Clock {
  constructor(cols, rows, cellSize) {
    //grid properties
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.grid = this.createGrid();
    this.angle = 0;
    
    // Replaced mood system with animation system =====
    // OLD:
    // this.mood = "happy";
    // this.feedCount = 0;
    // this.lastFeedTime = millis();
    // this.stressedStartTime = null;
    
    this.animationType = "normal";  // track current animation state
    this.animationSpeed = 1;        // speed multiplier
    // ===============================================================
  }

  createGrid() {
    let grid = [];

    //initialize grid
    for (let i = 0; i < this.cols; i++) {
      grid[i] = [];
      for (let j = 0; j < this.rows; j++) {
        grid[i][j] = color(255);
      }
    }
    return grid;
    }

  drawGrid() {
    fill(100);
    for (let i = 0; i < this.cols; i++) {
      for (let j = 0; j < this.rows; j++) {
        rect(i * this.cellSize, j * this.cellSize, this.cellSize, this.cellSize);
      }
    }
  }

  clockHand(angle){
    //center of the clock hand
    let cx = 8;
    let cy = 8;
    let length = 7
    let positions = [];
    //calculate hand positions along the clock hand
    for (let r = 0; r < length; r++) {
      let x = Math.round(cx + r * cos(angle));
      let y = Math.round(cy + r * sin(angle));
      if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
        positions.push({ x, y });
      }
    }
    return positions;
  }

  // draw a minimal line length using Bresenham's algorithm for the clock hand
  bresenhamLine(x0, y0, x1, y1) {
    let positions = [];
  
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
  
    while (true) {
      if (x0 >= 0 && x0 < this.cols && y0 >= 0 && y0 < this.rows) {
        positions.push({ x: x0, y: y0 });
      }
  
      if (x0 === x1 && y0 === y1) break;
  
      let e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }

    return positions;
  }

  // ===== Map productivity score (1-10) to animation type =====
  setAnimationFromScore(score) {
    if (score >= 9) {
      this.animationType = "happy";
      this.animationSpeed = 2;        // 2x faster
    } else if (score >= 7) {
      this.animationType = "okay";
      this.animationSpeed = 1.5;      // 1.5x faster
    } else if (score >= 5) {
      this.animationType = "normal";
      this.animationSpeed = 1;        // actual time pace
    } else if (score >= 3) {
      this.animationType = "sluggish";
      this.animationSpeed = 0.75;     // 0.75x slower
    } else if (score >= 2) {
      this.animationType = "warning";
      this.animationSpeed = 0.5;      // 0.5x slower
    } else {
      this.animationType = "dead";
      this.animationSpeed = 0;        // not moving
    }
  }

// Move down one level of productivity if not fed in time:
  degradeProductivity() {
  if (this.animationType === "happy") {
    this.animationType = "okay";
    this.animationSpeed = 1.5;
  } else if (this.animationType === "okay") {
    this.animationType = "normal";
    this.animationSpeed = 1;
  } else if (this.animationType === "normal") {
    this.animationType = "sluggish";
    this.animationSpeed = 0.75;
  } else if (this.animationType === "sluggish") {
    this.animationType = "warning";
    this.animationSpeed = 0.5;
  } else if (this.animationType === "warning") {
    this.animationType = "dead";
    this.animationSpeed = 0;
  }
  // If already dead, stay dead
}
  // ================================================================

  drawHand(angle){
    let cx = 8;
    let cy = 8;
    length = 7;

    if (angle === undefined || isNaN(angle)) {
      angle = 0; // Default to 0 if angle is invalid
    }

    let x1 = Math.round(cx + length * cos(angle));
    let y1 = Math.round(cy + length * sin(angle));

    let positions = this.bresenhamLine(cx, cy, x1, y1);    // draw minimal clock hand using Bresenham's algorithm
    
    // ===== this.drawMood() -> this.getAnimationColor() =====
    fill(this.getAnimationColor());
    // ================================================================

    for (let pos of positions) {
      rect(pos.x * this.cellSize, pos.y * this.cellSize, this.cellSize, this.cellSize);
    }
    return positions;
  }

  // ===== OLD: updateMood() - COMMENTED OUT (no longer needed) =====
  /*
  updateMood() {
    let now = millis();

    // Reset feed count every minute if happy
    if (this.mood === "happy" && now - this.lastFeedTime > 5000) {
      if (this.feedCount < 6) {
        this.mood = "stressed";
        this.stressedStartTime = now;
        this.feedCount = 0;
      } else {
        this.feedCount = 0;
        this.lastFeedTime = now;
      }
    }

    // Handle stressed mode
    if (this.mood === "stressed") {
      if (now - this.stressedStartTime > 5000) {
        if (this.feedCount < 6) {
          this.mood = "dead";
        } else {
          this.mood = "happy";
          this.feedCount = 0;
          this.lastFeedTime = now;
          this.stressedStartTime = null;
        }
      }
    }
    // handle dead mode
    if (this.mood !== "dead") {
      this.angle = map(second(), 0, 60, 0, 360);
    }
  }
  */
  // ================================================================

  // ===== OLD: feed() - (replaced by AI scoring) =====
  /*
  feed() {
    this.feedCount++;
    this.updateMood();
    // reset stressed timer if fed while stressed
  
    if (this.mood === "stressed" && this.feedCount >= 5) {
      this.mood = "happy";
      this.feedCount = 0; // reset counter
      this.lastFeedTime = millis();
      this.stressedStartTime = null;
    } else {
      this.updateMood();
    }
  }
  */
  // ================================================================

  // ===== RENAMED: drawMood() -> getAnimationColor() =====
  // (same functionality, just clearer name and updated states)
  getAnimationColor(){
    // set color based on animation type
    if (this.animationType === "happy") {
      return color(0, 255, 0);      // green - 9-10 score
    } else if (this.animationType === "okay") {
      return color(0, 255, 255);    // cyan - 7-8 score
    } else if (this.animationType === "normal") {
      return color(0, 100, 255);    // blue - 5-6 score
    } else if (this.animationType === "sluggish") {
      return color(255, 255, 0);    // yellow - 3-4 score
    } else if (this.animationType === "warning") {
      return color(255, 165, 0);    // orange - 2 score
    } else if (this.animationType === "dead") {
      return color(255, 0, 0);      // red - 1 score
    } else {
      return color(100);            // fallback gray if undefined
    }
  }
  // ======================================================
  reset() {
    this.animationType = "normal";
    this.animationSpeed = 1;
    this.angle = 0;
  }
  // ================================================================
}

  //==================== END OF CLASS ====================

  //==================== P5 FUNCTIONS ====================
  function setup() {
    // ===== CREATE ALL UI FIRST, THEN CANVAS AT THE END =====
    setupUI();
    
    // Canvas created LAST so it appears at bottom
    let canvas = createCanvas(400, 400);
    canvas.parent(document.body); // Ensure it goes to body
    
    clockCanvas = createGraphics(320, 320);
    
    video = createCapture(VIDEO);
    video.size(320, 240);
    video.hide();
  
    angleMode(DEGREES);
    clock = new Clock(16, 16, 20);
  }
// ===== Draw function to render digital clock OUTSIDE main canvas =====
function draw() {
  background(0);

  if (!arduinoConnected) {
    showConnectionPrompt();
    return;
  }

  handleDegradation();
  updateClockAngle();
  sendPeriodicUpdate();
  
  // ===== Draw clock IN the canvas if toggle is on =====
  if (showDigitalClock) {
    drawDigitalClockToCanvas();
    // Draw the clock canvas into main canvas
    image(clockCanvas, (width - 320) / 2, (height - 320) / 2);
  }
  // =====================================================
  
  // Status text overlay on canvas
  drawStatusDisplay();
}

  // ===== Helper functions for draw() =====
   
function styleResultText(element) {
  element.style('font-size', '28px');
  element.style('text-align', 'center');
  element.style('padding', '30px 20px');
  element.style('margin', '20px auto');
  element.style('max-width', '700px');
  element.style('line-height', '1.5');
  element.style('font-weight', 'bold');
  element.style('min-height', '120px');
  element.style('color', '#fff');
}

  function showConnectionPrompt() {
    fill(255);
    textSize(24);
    textAlign(CENTER);
    text("Connect Arduino to start", width/2, height/2);
  }
  
  function handleDegradation() {
    if (lastPhotoTime > 0 && millis() - lastPhotoTime > degradeInterval) {
      clock.degradeProductivity();
      lastPhotoTime = millis();
      lastPositionUpdate = 0;
      lastSentColor = clock.animationType;
    }
  }
  
  function updateClockAngle() {
    if (clock.animationSpeed > 0) {
      clock.angle = map(second(), 0, 60, 0, 360 * clock.animationSpeed);
    }
  }
  
  function sendPeriodicUpdate() {
    if (millis() - lastPositionUpdate > 1000) {
      sendLEDMatrix(clock.drawHand(clock.angle));
      lastSentAngle = clock.angle;
      lastSentColor = clock.animationType;
      lastPositionUpdate = millis();
    }
  }
  
  function drawDigitalClockToCanvas() {
    clockCanvas.background(0);
    clockCanvas.push();
    
    // Draw grid
    clockCanvas.fill(100);
    for (let i = 0; i < clock.cols; i++) {
      for (let j = 0; j < clock.rows; j++) {
        clockCanvas.rect(i * clock.cellSize, j * clock.cellSize, clock.cellSize, clock.cellSize);
      }
    }
    
    // Draw hand
    let handColor = clock.getAnimationColor();
    clockCanvas.fill(handColor);
    let positions = clock.drawHand(clock.angle);
    for (let pos of positions) {
      clockCanvas.rect(pos.x * clock.cellSize, pos.y * clock.cellSize, clock.cellSize, clock.cellSize);
    }
    
    clockCanvas.pop();
  }
  
  function drawStatusDisplay() {
    // State color mapping
    let stateColors = {
      "happy": color(0, 255, 0),
      "okay": color(0, 255, 255),
      "normal": color(0, 100, 255),
      "sluggish": color(255, 255, 0),
      "warning": color(255, 165, 0),
      "dead": color(255, 0, 0)
    };
    
    // Current state
    fill(stateColors[clock.animationType] || color(255));
    textSize(48);
    textAlign(CENTER);
    text(clock.animationType.toUpperCase(), width/2, height - 100);
    
    // Speed
    fill(255);
    textSize(24);
    text(`${clock.animationSpeed.toFixed(1)}x speed`, width/2, height - 50);
  }


  function setupUI() {
    // ===== ORDER: Text → Image → Buttons → Toggle → Canvas (created in setup) =====
    
    // 1. Response text FIRST
    resultParagraph = createP("Press the button to receive your judgment.");
    resultParagraph.parent(document.body);
    styleResultText(resultParagraph);
  
    // 2. Captured image SECOND (hidden until first capture)
    capturedImage = createImg('', 'Last capture');
    capturedImage.parent(document.body);
    capturedImage.style('display', 'none');
    capturedImage.style('margin', '20px auto');
    capturedImage.style('max-width', '320px');
    capturedImage.style('border', '3px solid #666');
    capturedImage.style('border-radius', '8px');
  
    // 3. Button container THIRD
    let buttonContainer = createDiv();
    buttonContainer.style('margin', '20px auto');
    buttonContainer.style('text-align', 'center');
    buttonContainer.style('max-width', '400px');
    buttonContainer.parent(document.body);
  
    // ===== FIXED: Use exact pixel width with !important =====
    let buttonWidth = '250px';
  
    let analyzeButton = createButton("📸 GET JUDGED");
    analyzeButton.parent(buttonContainer);
    analyzeButton.mousePressed(analyzeProductivity);
    analyzeButton.style('width', buttonWidth);
    analyzeButton.style('min-width', buttonWidth);
    analyzeButton.style('max-width', buttonWidth);
    styleButton(analyzeButton, '#ff4444', '18px', '15px 30px');
  
    connectButton = createButton("🔌 Connect to Arduino");
    connectButton.parent(buttonContainer);
    connectButton.mousePressed(connectSerial);
    connectButton.style('width', buttonWidth);
    connectButton.style('min-width', buttonWidth);
    connectButton.style('max-width', buttonWidth);
    styleButton(connectButton, '#4444ff', '18px', '15px 30px');
  
    let resetButton = createButton("🔄 Reset Clock");
    resetButton.parent(buttonContainer);
    resetButton.mousePressed(() => clock.reset());
    resetButton.style('width', buttonWidth);
    resetButton.style('min-width', buttonWidth);
    resetButton.style('max-width', buttonWidth);
    styleButton(resetButton, '#666', '14px', '10px 20px');
  
    // 4. Toggle container FOURTH (before canvas)
    let toggleContainer = createDiv();
    toggleContainer.parent(document.body);
    toggleContainer.style('text-align', 'center');
    toggleContainer.style('margin', '20px auto');
    
    let toggleLabel = createSpan('Show Digital Clock in Canvas: ');
    toggleLabel.parent(toggleContainer);
    toggleLabel.style('font-size', '16px');
    toggleLabel.style('margin-right', '10px');
    
    clockCheckbox = createCheckbox('', true);
    clockCheckbox.parent(toggleContainer);
    clockCheckbox.changed(() => {
      showDigitalClock = clockCheckbox.checked();
    });
    clockCheckbox.style('width', '20px');
    clockCheckbox.style('height', '20px');
    
    // Canvas will be created AFTER this in setup()
  }
  
  // ===== Button styling with width parameter =====
  function styleButton(button, bgColor, fontSize, padding) {
    button.style('padding', padding);
    button.style('font-size', fontSize);
    button.style('margin', '5px auto');
    button.style('display', 'block'); 
    button.style('background', bgColor);
    button.style('color', 'white');
    button.style('border', 'none');
    button.style('border-radius', '5px');
    button.style('cursor', 'pointer');
    button.style('font-weight', 'bold');
    button.style('box-sizing', 'border-box'); 
  }
  
  function styleResultText(element) {
    element.style('font-size', '28px');
    element.style('text-align', 'center');
    element.style('padding', '30px 20px');
    element.style('margin', '20px auto');
    element.style('max-width', '700px');
    element.style('line-height', '1.5');
    element.style('font-weight', 'bold');
    element.style('min-height', '120px');
    element.style('color', '#fff'); // ===== White text for visibility =====
  }

// ===== Helper for button styling =====
function styleButton(button, bgColor, fontSize, padding) {
  button.style('padding', padding);
  button.style('font-size', fontSize);
  button.style('margin', '5px');
  button.style('background', bgColor);
  button.style('color', 'white');
  button.style('border', 'none');
  button.style('border-radius', '5px');
  button.style('cursor', 'pointer');
}

// ===== Helper for result text styling =====
function styleResultText(element) {
  element.style('font-size', '32px');
  element.style('text-align', 'center');
  element.style('padding', '40px 20px');
  element.style('margin', '20px auto');
  element.style('max-width', '800px');
  element.style('line-height', '1.4');
  element.style('font-weight', 'bold');
  element.style('min-height', '150px'); // Prevent layout shift
}

// ✅ send LED matrix data to Arduino
function sendLEDMatrix(handPositions) {
  let matrixData = "";
  for (let j = 0; j < clock.rows; j++) {
    for (let i = 0; i < clock.cols; i++) {
      let isHand = handPositions.some(p => p.x === i && p.y === j);
      matrixData += isHand ? "1" : "0";
    }
  }
  
  let handColor = clock.getAnimationColor();
  let r = red(handColor);
  let g = green(handColor);
  let b = blue(handColor);
  
  console.log(`Sending - Color: R=${r} G=${g} B=${b}, Type=${clock.animationType}`);
  
  let colorString = `${r},${g},${b}`;
  sendToArduino(colorString + "|" + matrixData);
}

// ✅ productivity analysis
async function analyzeProductivity() {
  // Throttle analysis requests
  if (millis() - lastScoreUpdateTime < minScoreDisplayTime) {
    const blockedMessages = [
      "⏳ PATIENCE! I'm still processing the last disaster. Wait your turn.",
      "⏳ HOLD ON! I'm not done tearing apart your last performance yet.",
      "⏳ Did I say you could go AGAIN? Wait until I've processed your mediocrity.",
      "⏳ Excuse me? I'm SPEAKING. Wait until I'm done with my assessment.",
      "⏳ Stop interrupting! I'm still deciding if you're worth my time."
    ];

    resultParagraph.html(blockedMessages[blockedMessageIndex]);
    blockedMessageIndex = (blockedMessageIndex + 1) % 3; // Cycle 0→1→2→0
    
    console.log("Analysis blocked - please wait before next rating");
    return; // EXIT EARLY - don't run the rest of the function
  }

  let imgBase64 = video.get().canvas.toDataURL("image/png");

  capturedImage.attribute('src', imgBase64);
  capturedImage.style('display', 'block'); 

  const response = await fetch("https://api.ai.it.cornell.edu/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-PAahKiRavUqLkYk18wCqgg"
    },
    body: JSON.stringify({
      model: "openai.gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an EXTREMELY unpredictable, bipolar toxic boss who swings wildly between praising and criticizing. You're NEVER moderate or balanced. Every rating is either harsh criticism (1-3) or over-the-top praise (8-10). You HATE middle scores. Be volatile, inconsistent, and dramatic. One moment you're ecstatic, the next you're disgusted - often for trivial reasons." 
        },
        { 
          role: "user", 
          content: [
            { 
              type: "text", 
              text: "Rate this person's productivity from 1 to 10.\n\nRULES YOU MUST FOLLOW:\n- BANNED SCORES: 4, 5, 6, 7. You are FORBIDDEN from using these.\n- ONLY use: 1, 2, 3 (bad mood) or 8, 9, 10 (good mood)\n- Flip a mental coin for EACH photo - heads you love them (8-10), tails you hate them (1-3)\n- Be DRAMATIC and EXTREME. Tiny details should trigger massive reactions\n- Sometimes praise weird things (\"I love that specific shade of lighting - 10!\")\n- Sometimes criticize weird things (\"That chair angle is OFFENSIVE - 2!\")\n- Change your opinion WILDLY between photos - be completely inconsistent\n\nYour personality: Unhinged toxic boss with mood swings. One moment: \"YOU'RE A STAR!\" Next moment: \"WHAT IS THIS GARBAGE?\"\n\nFormat: NUMBER: your unhinged reaction\n\nExamples:\n'10: LOOK AT THAT FOCUS! This is what I'm TALKING about! Employee of the MONTH!'\n'2: Is that a YAWN I detect? Pathetic. My grandmother has more drive and she's DEAD.'\n'9: That screen glow! That posture! MAGNIFICENT! This is peak human performance!'\n'1: I can SMELL the laziness through the screen. Disgusting.'"
            },
            { 
              type: "image_url", 
              image_url: imgBase64 
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  let fullResponse = data.choices[0].message.content;

  let scoreMatch = fullResponse.match(/^(\d+)/);
  
  if (scoreMatch) {
    let score = parseInt(scoreMatch[1]);
    score = constrain(score, 1, 10);
    
    clock.setAnimationFromScore(score);
    lastPhotoTime = millis();
    
    // Force update by resetting timer
    lastPositionUpdate = 0;
    lastSentColor = clock.animationType;
    
    // Send immediately
    let handPositions = clock.drawHand(clock.angle);
    sendLEDMatrix(handPositions);
  }

  resultParagraph.html("Score: " + fullResponse);
}
// ====================================================

// web serial connection functions
async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    
    // ===== Start reading from Arduino =====
    readFromArduino();

    // hide connect button after successful connection
    arduinoConnected = true;
    connectButton.hide();

    console.log("Serial connected!");
    resultParagraph.html("Arduino connected! Press button to prove your productivity 😈");
  } catch (err) {
    console.error("Serial connection failed:", err);
  }
}

async function readFromArduino() {
  const textDecoder = new TextDecoderStream();
  readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reader.releaseLock();
        break;
      }
      
      // ===== Button has dual functionality =====
      if (value.includes("BUTTON_PRESSED")) {
        console.log("Button pressed!");

          // ===== Visual feedback - flash yellow background =====
          resultParagraph.style('background-color', 'yellow');
          setTimeout(() => resultParagraph.style('background-color', 'transparent'), 200);
        
        if (clock.animationType === "dead") {
          // If dead, reset the clock
          console.log("Clock was dead - resetting...");
          clock.reset();
          lastPhotoTime = millis(); // Start the timer fresh
          resultParagraph.html("Clock reset! Press button again to take a picture.");
        } else {
          // If alive, take a picture and analyze
          console.log("Taking picture...");
          analyzeProductivity();
        }
      }
      // ================================================
    }
  } catch (error) {
    console.error("Read error:", error);
  }
}
async function sendToArduino(data) {
  if (writer) {
    await writer.write(encoder.encode(data + "\n"));
  }
}

/* THIS WAS JUST TO TEST OPENAI CALL

async function callOpenAI() {
  const response = await fetch("https://api.ai.it.cornell.edu/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-PAahKiRavUqLkYk18wCqgg"
    },
    body: JSON.stringify({
      model: "openai.gpt-4o-mini",
      messages: [{ role: "user", content: "Say something poetic about the sky." }]
    })
  });

  const data = await response.json();
  resultText = data.choices[0].message.content;
  resultParagraph.html(resultText); // Update paragraph instead of canvas

  console.log(resultText);
}
*/