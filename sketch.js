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
function findBaseFile(mood, variant) {
  const baseMap = {
    'contemplative': 'Contemplative.mp3',
    'cozy':          variant === 2 ? 'Cozy02.mp3'       : 'Cozy01.mp3',
    'enchanted':     'Enchanted01.mp3',
    'epic':          variant === 2 ? 'Epic02.mp3'       : 'Epic01.mp3',
    'joyful':        'Joyful01.mp3',
    'melancholy':    variant === 2 ? 'Melancholy02.mp3' : 'Melancholy01.mp3',
    'mysterious':    'Myterious01.mp3',  // filename has a typo on disk — matches actual file
    'peaceful':      'Peaceful01.mp3',
    'ominous':       'Ominous01.mp3',
    'romantic':      'Romantic01.mp3',
    'scary':         'Scary01.mp3',
    'suspense':      'Suspense01.mp3'
  };

  let file = baseMap[mood.toLowerCase()];
  if (!file) {
    console.error('No base file found for mood:', mood);
    return null;
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
          content: `Analyze this passage and return JSON with the emotional mood, physical setting, and intensity.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "mood": "one of the moods below",
  "setting": "one of the settings below",
  "intensity": 0.7
}

MOOD OPTIONS (read definitions carefully):
- contemplative: Thoughtful, reflective, pondering. Character thinking about life, destiny, or choices. May include longing or wonder, but NOT sadness. Peaceful internal thought.
- cozy: Warm, comfortable, safe. A quiet moment at home or outdoors. Early morning, a familiar place, a character at peace.
- enchanted: Magical, wondrous. A sense of discovery, awe, or gentle magic. Mysterious woods, spells, fairy-tale wonder.
- epic: Grand, sweeping, heroic. A great journey, battle, or moment of high adventure.
- joyful: Happy, celebratory, lighthearted. Laughter, excitement, delight.
- melancholy: ACTUALLY SAD — grief, loss, heartbreak, sorrow. Must involve genuine sadness or pain. IMPORTANT: if a character is pondering but not sad → use contemplative, not melancholy.
- mysterious: Curious or eerie. Something unknown, hidden, or unexplained. A magical or unsettling vibe without clear danger.
- peaceful: Calm, still, serene. Nature at rest, a quiet moment, no tension or conflict.
- ominous: Subtle dread. A character sensing something bad is coming. Psychological, not action-based. Not the same as scary — ominous is the feeling before something happens.
- romantic: Love, longing, tenderness, attraction between characters.
- scary: Active danger or fear. Horror, a threat looming, a character in genuine danger or terror.
- suspense: Tension and uncertainty. Something is about to happen but it's unclear what. Apprehension, right before action.

SETTING OPTIONS:
- forest: Woodland, trees, nature, outdoor greenery
- storm: Rain, thunder, dark weather, rough sea
- hearth: Indoors by fire, warm domestic space, candlelight
- citynight: Urban streets, nighttime city, lamplit alleys
- none: No clear physical setting, or setting doesn't fit the options above

INTENSITY: 0.3 (quiet, subtle scene) to 1.0 (overwhelming, climactic)`
        },
        {
          role: 'user',
          content: `Analyze this passage:\n\n${passage}`
        }
      ],
      max_tokens: 100,
      temperature: 0.3
    })
  });

  let data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Atmosphere analysis failed');

  let atmosphereText = data.choices[0].message.content.trim();
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

  stopAllAudio();

  let mood      = atmosphere.mood;
  let setting   = atmosphere.setting;
  let intensity = atmosphere.intensity || 0.7;

  // Moods with two audio variants — pick randomly for variety
  const moodsWithVariants = ['cozy', 'epic', 'melancholy'];
  let variant = moodsWithVariants.includes(mood) ? (Math.random() < 0.5 ? 1 : 2) : 1;

  // Volume scales with intensity: quiet scenes are softer, climactic ones louder
  let baseVolume = 0.4 + (intensity * 0.5);

  // Play base mood track
  let baseFile = findBaseFile(mood, variant);
  if (baseFile) {
    currentBase = new Howl({
      src: [`assets/audio/base/${baseFile}`],
      loop: true,
      volume: baseVolume
    });
    currentBase.once('load', function() {
      let duration = currentBase.duration();
      let randomStart = Math.random() * Math.max(0, duration - 5);
      currentBase.seek(randomStart);
    });
    currentBase.play();
    console.log('Playing base:', baseFile, 'volume:', baseVolume);
  }

  // Play setting texture if a physical location was identified
  if (setting && setting !== 'none') {
    let textureFile = findTextureFile(setting);
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
  }

  // Apply mood color tint to passage display
  applyMoodTint(moodToColor(mood), intensity);

  let settingLabel = (setting && setting !== 'none') ? ` · ${setting}` : '';
  updateStatus(`🎵 ${mood}${settingLabel}`, '#27ae60');
}

function stopAllAudio() {
  if (currentBase) {
    currentBase.stop();
    currentBase = null;
  }

  currentTextures.forEach(texture => texture.stop());
  currentTextures = [];
}

//---------------------------------------
//           MOOD COLOR + UI TINT
//---------------------------------------
function moodToColor(mood) {
  const colorMap = {
    'contemplative': '#4169E1',  // royal blue
    'cozy':          '#FF8C00',  // warm amber
    'enchanted':     '#9370DB',  // medium purple
    'epic':          '#B8860B',  // dark gold
    'joyful':        '#F59E0B',  // amber yellow
    'melancholy':    '#1D4ED8',  // deep blue
    'mysterious':    '#6B21A8',  // deep purple
    'peaceful':      '#16A34A',  // forest green
    'ominous':       '#312E81',  // dark indigo
    'romantic':      '#BE185D',  // deep rose
    'scary':         '#B91C1C',  // deep red
    'suspense':      '#0F766E'   // dark teal
  };
  return colorMap[mood] || '#888888';
}

function applyMoodTint(hexColor, intensity) {
  // Opacity scales with intensity: very subtle at 0.3, noticeable at 1.0
  let opacity = 0.05 + (intensity * 0.15);
  passageDiv.style('background-color', hexToRgba(hexColor, opacity));
  passageDiv.style('transition', 'background-color 1.5s ease');
}

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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