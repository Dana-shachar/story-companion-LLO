let selectButton;
let passageDiv;
let statusDiv;

// Web Serial connection
let port;
let writer;
let reader;
let encoder = new TextEncoder();
let arduinoConnected = false;
let serialButton;  // 

// Book list
let books = [
  '1984.pdf',
  'A_Handmaids_Tale.pdf',
  'Alice_in_Wonderland.pdf',
  'Dune.pdf',
  'Frankenstein.pdf',
  'HP1.pdf',
  'LOTR1.pdf',
  'Pride_and_Prejudice.pdf'
];

function setup() {
  //createCanvas(windowWidth, windowHeight);
  //background(245, 247, 250);
  
  createUI();
}

function draw() {
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ======== styling and UI creation ========
function createUI() {
  // Title
  let title = createDiv('Narro - Your Story Companion');
  title.id('title');

  // Connect Arduino Button
  serialButton = createButton('🔌 Connect Arduino');
  serialButton.id('serial-button');
  serialButton.mousePressed(connectSerial);
  
  // Button
  selectButton = createButton('Read a Passage');
  selectButton.id('select-button');
  selectButton.mousePressed(selectRandomPassage);
  
  // Status
  statusDiv = createDiv('Click button to begin');
  statusDiv.id('status');
  
  // Passage display
  passageDiv = createDiv('');
  passageDiv.id('passage-display');
}

// ==============================
//        MAIN FUNCTION
//===============================

async function selectRandomPassage() {
  selectButton.attribute('disabled', '');
  selectButton.html('⏳ Working...');
  passageDiv.hide();
  
  // Stop any previous audio
  stopAllAudio();
  
  try {
    // 1. Pick random book
    updateStatus('Selecting book...', '#3498db');
    await wait(300);
    
    let book = random(books);
    let bookName = book.replace('.pdf', '').replace(/_/g, ' ');
    
    // 2. Load PDF
    updateStatus(`📖 Opening "${bookName}"...`, '#3498db');
    let pdf = await pdfjsLib.getDocument(`assets/books/${book}`).promise;
    
    // 3. Extract text
    updateStatus(`📄 Reading ${pdf.numPages} pages...`, '#3498db');
    let text = await extractText(pdf);
    
    // 4. Get passage from AI
    updateStatus('🤖 AI selecting atmospheric passage...', '#9b59b6');
    let passage = await getPassage(text, bookName);
    
    // 5. Display passage
    passageDiv.html(passage);
    passageDiv.show();
    updateStatus(`✨ Passage from "${bookName}"`, '#27ae60');
    await wait(500);
    
    // 6. Analyze atmosphere
    let atmosphere = await analyzeAtmosphere(passage);
    
    // 7. Play audio
    playAtmosphere(atmosphere);
    
    selectButton.removeAttribute('disabled');
    selectButton.html('Read Another Passage');
    
  } catch (error) {
    console.error(error);
    updateStatus('❌ Error: ' + error.message, '#e74c3c');
    selectButton.removeAttribute('disabled');
    selectButton.html('Try Again');
  }
}


// ======================================
//               HELPERS
// ======================================
function updateStatus(message, color) {
  statusDiv.html(message);
  statusDiv.style('color', color);
}

//---------------------------------------
//                SOUNDS
//---------------------------------------
function findBaseFile(baseName, variant) {
  // Map atmosphere name to actual file (matching your assets)
  const baseMap = {
    'contemplative': 'Contemplative.mp3',
    'cozy': variant === 2 ? 'Cozy02.mp3' : 'Cozy01.mp3',
    'enchanted': 'Enchanted01.mp3',
    'epic': variant === 2 ? 'Epic02.mp3' : 'Epic01.mp3',
    'joyful': 'Joyful01.mp3',
    'melancholy': variant === 2 ? 'Melancholy02.mp3' : 'Melancholy01.mp3',
    'mysterious': 'Mysterious01.mp3',
    'peaceful': 'Peaceful01.mp3',
    'ominous': 'Ominous01.mp3',
    'romantic': 'Romantic01.mp3',
    'scary': 'Scary01.mp3',
    'suspense': 'Suspense01.mp3'
  };
  
  let file = baseMap[baseName.toLowerCase()];
  
  if (!file) {
    console.error('No base file found for:', baseName);
    return null;  // if AI couldn't match the audio, don't play anything
  }
  
  return file;
}

async function extractText(pdf) {
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 20 === 0) {
      updateStatus(`📄 Reading pages... (${i}/${pdf.numPages})`, '#3498db');
    }
    let page = await pdf.getPage(i);
    let content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n\n';
  }
  return text;
}

async function getPassage(fullText, bookName) {
  let response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Select ONE atmospheric passage of 80 - 160 words from the story.
                    IGNORE: table of contents, acknowledgements, prefaces, introduction, copyright, 
                    chapter headers, page numbers, website tags and any text information that isn't actual story content.
                    ONLY select actual narrative with strong mood / atmosphere.
                    Return ONLY the passage text, nothing else.`
        },
        {
          role: 'user',
          content: `From "${bookName}":\n\n${fullText.substring(0, 120000)}`
        }
      ],
      max_tokens: 600
    })
  });
  
  let data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'API failed');
  
  return data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeAtmosphere(passage) {
  updateStatus('🎨 AI analyzing atmosphere...', '#9b59b6');
  
  let response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Analyze the atmosphere of this passage and return JSON.

                    Return ONLY valid JSON (no markdown, no code blocks):
                    {
                       "baseAtmosphere": "one of the options below",
                        "variant": 1 or 2,
                        "textures": ["texture1", "texture2"],
                        "volume": 0.7
                    }

                   Available base atmospheres (READ DEFINITIONS CAREFULLY):
                  - contemplative: Thoughtful, reflective, pondering. Character thinking about life, destiny, or choices. 
                    May include longing or wonder, but NOT sadness. Peaceful internal thought. (only 1 variant)
                  - cozy (2 variants)
                    - variant 1: [this variant is very gentle guitar, good for cozy quiet moment, early morning outdoors, or a character enjoying a peaceful moment at home]
                    - variant 2: [this variant is more atmospheric with a touch of piano and soft strings, good for a rainy day scene, a character reflecting on a bittersweet memory, or a quiet moment of solitude]
                  - enchanted
                    - variant 1: [lighter magical feeling, fairy-tale wonder, magical woods, good for scenes with a sense of discovery, awe, or gentle magic]
                  - epic (2 variants)
                    - variant 1: [for epic journey scenes, grand and sweeping, heroic and adventurous]
                    - variant 2: [this variant is more intense with an orchestral focus, great for a build up to a climax or a battle scene]

                  - joyful (only 1 variant)

                  - melancholy: ACTUALLY SAD - grief, loss, heartbreak, sorrow, depression. NOT just thinking or wondering - must involve genuine sadness or pain.
                  - variant 1: [very sorrowful, with a violin, good for a solitary character reflecting on loss or tragedy]
                  - variant 2: [this variant is more of a wistful sadness, with a piano focus, good for nostalgic scenes or bittersweet moments]
                    IMPORTANT: If character is thinking/pondering but NOT sad → use CONTEMPLATIVE, not melancholy! 

                  - mysterious (only 1 variant) good for curious or eerie scenes, give a magical or unknown vibe.

                  - peaceful (only 1 variant)

                  - ominous: not to be confused with scary! ominous is more subtle, similar to suspense but more emotional and psychological. 
                  use it when a situation is grim or when a character is worried of negative things that are coming, or thinks something bad will happen. (only 1 variant)

                  - romantic (only 1 variant)

                  - scary: use for horror type situations or high stakes action where there is imenant danger looming, 
                  or when a character is afraid of something. (only 1 variant)

                  - suspense: use for scenes where there is tension or the situation is not clear to the main character, 
                  there is mystery but also fear or apprehensiveness or right before an action scene. when it's unclear if something ba is about to happen or 
                  the main character doesn't know how others will react. (only 1 variant)

                    Choose variant that best matches the passage's specific mood and tone.

                    Volume: 0.3 (quiet/subtle) to 1.0 (loud/intense)

                    If no texture fits the scene, use empty array: "textures": []`
        },
        {
          role: 'user',
          content: `Analyze this passage:\n\n${passage}`
        }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  });
  
  let data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Atmosphere analysis failed');
  
  let atmosphereText = data.choices[0].message.content.trim();
  
  // Clean up markdown code blocks if AI adds them
  atmosphereText = atmosphereText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  let atmosphere = JSON.parse(atmosphereText);
  
  console.log('Atmosphere:', atmosphere);
  return atmosphere;
}

function findTextureFile(textureName) {
  const textureMap = {
    'forest': 'Forest01.mp3',
    'storm': 'Storm01.mp3',
    'hearth': 'Hearth01.mp3',
    'citynight': 'CityNight01.mp3'
  };
  
  let file = textureMap[textureName.toLowerCase()];
  
  if (!file) {
    console.error('No texture file found for:', textureName);
    return null;
  }
  
  return file;
}

// Track currently playing audio
let currentBase = null;
let currentTextures = [];

function playAtmosphere(atmosphere) {
  updateStatus('🎵 Loading atmosphere...', '#e67e22');
  
  // Stop any currently playing audio
  stopAllAudio();
  
  // Play base atmosphere
  let baseName = atmosphere.baseAtmosphere;
  let variant = atmosphere.variant || 1;  // Default to variant 1 if not specified
  let baseFile = findBaseFile(baseName, variant);
  
  if (baseFile) {
    currentBase = new Howl({
      src: [`assets/audio/base/${baseFile}`],
      loop: true,
      volume: atmosphere.volume || 0.7
    });
    
    // Random start position for variety
    currentBase.once('load', function() {
      let duration = currentBase.duration();
      let randomStart = Math.random() * Math.max(0, duration - 5);
      currentBase.seek(randomStart);
    });
    
    currentBase.play();
    console.log('Playing base:', baseFile, 'at volume', atmosphere.volume);
  } else {
    console.log('No base audio to play');
  }
  
  // Play audio textures
  if (atmosphere.textures && atmosphere.textures.length > 0) {
      atmosphere.textures.forEach(textureName => {
      let textureFile = findTextureFile(textureName);
      if (textureFile) {
        let texture = new Howl({
          src: [`assets/audio/textures/${textureFile}`],
          loop: true,
          volume: 0.4
        });
        texture.play();
        currentTextures.push(texture);
        console.log('Playing texture:', textureFile);
      }
    });
  }
  
  updateStatus(`🎵 ${baseName}`, '#27ae60');
}

function stopAllAudio() {
  if (currentBase) {
    currentBase.stop();
    currentBase = null;
  }
  
  currentTextures.forEach(texture => texture.stop());
  currentTextures = [];
}

//=====================================================
//                WEB SERIAL CONNECTION
//=====================================================

async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });  // Match your Arduino baud rate
    writer = port.writable.getWriter();
    
    // Start reading from Arduino
    readFromArduino();
    
    arduinoConnected = true;
    serialButton.hide();  // hide button after successful connection

    
    console.log("Arduino connected!");
    updateStatus('✅ Arduino connected', '#27ae60');
    
  } catch (err) {
    console.error("Serial connection failed:", err);
    updateStatus('❌ Arduino connection failed', '#e74c3c');
  }
}

async function readFromArduino() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();
  
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reader.releaseLock();
        break;
      }
      
      console.log("Arduino says:", value);
      
      // When Arduino button is pressed, trigger passage selection
      if (value.includes("BUTTON_PRESSED")) {
        console.log("Arduino button pressed - triggering passage selection");
        selectRandomPassage();
      }
    }
  } catch (error) {
    console.error("Read error:", error);
  }
}

async function sendToArduino(data) {
  if (writer) {
    try {
      await writer.write(encoder.encode(data + "\n"));
      console.log("Sent to Arduino:", data);
    } catch (err) {
      console.error("Write error:", err);
    }
  }
}