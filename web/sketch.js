// ── DOM refs ──────────────────────────────────────────────────────────────────
let loadScreenEl, readerEl;
let loadButton, loadStatusEl, connectButton;
let bookTitleEl, readingProgressEl, progressFillEl;
let readerTextEl, readingStripeEl, atmosphereStatusEl, moodDisplayEl, analyzeStatusEl;

// ── Reader state ──────────────────────────────────────────────────────────────
let allSentences       = [];
let currentBookName    = '';
let totalBookPages     = 0;
let currentSentenceIdx = 0;
let currentLineIdx     = 0;
let linePositions      = [];
let advanceTimer       = null;
let speedMultiplier    = 1.0;
let isAnalyzing        = false;

// ── Web Serial ────────────────────────────────────────────────────────────────
let port, writer, reader;
let encoder        = new TextEncoder();
let arduinoConnected = false;
let serialMsgId    = 0;
let pcLedGateEnabled = false; // reported by ESP32 (pc_led_gate)
let lastLedPayload   = null;  // last LED command sent to ESP32 (string)
let lastGateEnabled  = false; // for edge-detecting gate ON

// ── Audio ─────────────────────────────────────────────────────────────────────
let currentBase     = null;
let currentTextures = [];
let isPaused        = false;
let isMuted         = false;
let loadGeneration  = 0; // incremented on each new load; stale loads abort when they see a newer gen

// ── Book list ─────────────────────────────────────────────────────────────────
const books = [
  '1984.pdf',
  'The_Handmaids_Tale.pdf',
  'Alice_in_Wonderland.pdf',
  'Dune.pdf',
  'Frankenstein.pdf',
  'HP1.pdf',
  'LOTR1.pdf',
  'Pride_and_Prejudice.pdf'
];

// ── Book display names (for reader header) ─────────────────────────────────────
const BOOK_DISPLAY_NAMES = {
  '1984.pdf':                  '1984',
  'The_Handmaids_Tale.pdf':      "The Handmaid's Tale",
  'Alice_in_Wonderland.pdf':   "Alice's Adventures in Wonderland",
  'Dune.pdf':                  'Dune',
  'Frankenstein.pdf':          'Frankenstein',
  'HP1.pdf':                   'Harry Potter and the Philosopher\'s Stone',
  'LOTR1.pdf':                 'The Lord of the Rings',
  'Pride_and_Prejudice.pdf':   'Pride and Prejudice',
};

// ── Curated demo scenes (alphabetical) ────────────────────────────────────────
// Order matches the buttons in index.html
const CURATED_SCENES = [
  // Alice in Wonderland
  { book: 'Alice_in_Wonderland.pdf', startPage: 8,   endPage: 12,  mood: 'whimsical',  intensity: 0.7,  baseFile: 'Whimsical01.mp3',          textureFile: 'Forest01.mp3',         textureVol: 0.3,  startFrom: 'Oh, dear'            },
  { book: 'Alice_in_Wonderland.pdf', startPage: 40,  endPage: 44,  mood: 'scary',      intensity: 0.8,  baseFile: 'ScaryStrings01.mp3',        textureFile: 'Garden01.mp3',         textureVol: 0.5  },
  { book: 'Alice_in_Wonderland.pdf', startPage: 34,  endPage: 38,  mood: 'whimsical',  intensity: 0.7,  baseFile: 'Whimsical02.mp3',          textureFile: 'Garden01.mp3',         textureVol: 0.5  },
  // Frankenstein
  { book: 'Frankenstein.pdf',        startPage: 84,  endPage: 88,  mood: 'scary',      intensity: 0.9,  baseFile: 'ScaryStrings02.mp3',        textureFile: 'Storm01.mp3',          textureVol: 0.3,  startFrom: 'dreary night of November'   },
  // Harry Potter
  { book: 'HP1.pdf',                 startPage: 155, endPage: 159, mood: 'melancholy', intensity: 0.75, baseFile: 'Emotional01.mp3',           textureFile: 'Hearth01.mp3',         textureVol: 0.3,  startFrom: "'Mum?' he whispered"            },
  { book: 'HP1.pdf',                 startPage: 43,  endPage: 51,  mood: 'mysterious', intensity: 0.8,  baseFile: 'Mysterious01.mp3',          textureFile: 'StormInterior01.mp3',  textureVol: 0.3,  startFrom: 'Hagrid stared wildly'                   },
  { book: 'HP1.pdf',                 startPage: 188, endPage: 192, mood: 'scary',      intensity: 0.85, baseFile: 'Suspense02.mp3',            textureFile: 'Forest01.mp3',         textureVol: 0.3,  startFrom: 'Harry had taken one step towards it'    },
  // Lord of the Rings
  { book: 'LOTR1.pdf',               startPage: 30,  endPage: 34,  mood: 'joyful',     intensity: 0.8,  baseFile: 'PartyCeltic01.mp3',         textureFile: 'Tavern01.mp3',         textureVol: 0.15 },
  { book: 'LOTR1.pdf',               startPage: 370, endPage: 374, mood: 'epic',       intensity: 0.9,  baseFile: 'Epic01.mp3',                textureFile: 'Battle01.mp3',         textureVol: 0.2,  startFrom: 'Arrows fell among them'  },
  // Pride & Prejudice
  { book: 'Pride_and_Prejudice.pdf', startPage: 180, endPage: 184, mood: 'romantic',   intensity: 0.75, baseFile: 'HopefulStrings03.mp3',      textureFile: 'Garden01.mp3',         textureVol: 0.5  },
  // The Handmaid's Tale
  { book: 'The_Handmaids_Tale.pdf',    startPage: 33,  endPage: 37,  mood: 'ominous',    intensity: 0.8,  baseFile: 'Ominous03.mp3',             textureFile: 'CityNight01.mp3',      textureVol: 0.3,  startFrom: 'Now we turn our backs'   },
];

// ── Base-track companion map (crossfade on end, not loop) ─────────────────────
const BASE_COMPANIONS = {
  'Cozy01.mp3':           'Cozy02.mp3',
  'Cozy02.mp3':           'Cozy01.mp3',
  'Epic01.mp3':           'Epic02.mp3',
  'Epic02.mp3':           'Epic01.mp3',
  'HopefulStrings01.mp3': 'HopefulStrings02.mp3',
  'HopefulStrings02.mp3': 'HopefulStrings03.mp3',
  'HopefulStrings03.mp3': 'HopefulStrings01.mp3',
  'Melancholy01.mp3':     'Melancholy02.mp3',
  'Melancholy02.mp3':     'Melancholy03.mp3',
  'Melancholy03.mp3':     'Melancholy01.mp3',
  'PartyCeltic01.mp3':    'PartyCeltic02.mp3',
  'PartyCeltic02.mp3':    'PartyCeltic01.mp3',
};

// ── p5 entry points ───────────────────────────────────────────────────────────
function setup() {
  noCanvas();

  loadScreenEl       = document.getElementById('load-screen');
  readerEl           = document.getElementById('reader');
  loadButton         = document.getElementById('load-button');
  loadStatusEl       = document.getElementById('load-status');
  connectButton      = document.getElementById('connect-button');
  bookTitleEl        = document.getElementById('book-title');
  readingProgressEl  = document.getElementById('reading-progress');
  progressFillEl     = document.getElementById('progress-fill');
  readerTextEl       = document.getElementById('reader-text');
  readingStripeEl    = document.getElementById('reading-stripe');
  atmosphereStatusEl = document.getElementById('atmosphere-status');
  moodDisplayEl      = document.getElementById('mood-display');
  analyzeStatusEl    = document.getElementById('analyze-status');

  loadButton.addEventListener('click', () => {
    loadScreenEl.style.display = 'none';
  });
  connectButton.addEventListener('click', connectSerial);

  document.getElementById('pause-btn').addEventListener('click', togglePause);
  document.getElementById('mute-btn').addEventListener('click', () => setMuted(!isMuted));

  document.getElementById('analyze-btn').addEventListener('click', () => {
    triggerAtmosphereAnalysis(currentSentenceIdx);
  });

  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed)));
  });

  document.querySelectorAll('.scene-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => loadCuratedScene(idx));
  });

  document.getElementById('random-scene-btn').addEventListener('click', openBook);
}

function draw() {
  // empty! everything is event-driven in this project and designed in html/css.
}


// =====================================================
//   OPEN BOOK
// =====================================================

async function openBook() {
  loadButton.disabled    = true;
  loadButton.textContent = 'Opening...';
  setLoadStatus('Selecting book...');
  stopAllAudio();
  let gen = ++loadGeneration;

  try {
    // Pick a random book
    let book = books[Math.floor(Math.random() * books.length)];
    currentBookName = BOOK_DISPLAY_NAMES[book] || book.replace('.pdf', '').replace(/_/g, ' ');

    setLoadStatus(`Opening "${currentBookName}"...`);
    let pdf = await pdfjsLib.getDocument(`assets/books/${book}`).promise;
    if (gen !== loadGeneration) return;
    totalBookPages = pdf.numPages;

    // Random landing page: 1%–99% of book
    let landingPage = Math.floor(totalBookPages * (0.01 + Math.random() * 0.98));
    landingPage = Math.max(1, Math.min(totalBookPages, landingPage));

    // 5 pages centred on landing page
    let startPage = Math.max(1, landingPage - 2);
    let endPage   = Math.min(totalBookPages, startPage + 4);

    setLoadStatus(`Reading pages ${startPage}–${endPage} of ${totalBookPages}...`);
    let text = await extractText(pdf, startPage, endPage);
    if (gen !== loadGeneration) return;

    // Parse and render
    allSentences = parseSentences(text);
    renderSentences(allSentences);
    updateReadingProgress(landingPage);

    // Show reader
    loadScreenEl.style.display = 'none';
    readerEl.style.display     = 'flex';

    // Position stripe on first sentence after layout settles
    startAdvancing();
    triggerAtmosphereAnalysis(0);

  } catch (error) {
    console.error(error);
    setLoadStatus('Error: ' + error.message);
    loadButton.disabled    = false;
    loadButton.textContent = 'Try Again';
  }
}


// =====================================================
//   CURATED SCENES
// =====================================================

async function loadCuratedScene(idx) {
  let scene = CURATED_SCENES[idx];
  if (!scene) return;

  let gen = ++loadGeneration;
  loadButton.disabled = true;
  stopAllAudio();
  playCuratedAudio(scene); // called synchronously within click gesture — required for browser autoplay

  try {
    currentBookName = BOOK_DISPLAY_NAMES[scene.book] || scene.book.replace('.pdf', '').replace(/_/g, ' ');
    let pdf = await pdfjsLib.getDocument(`assets/books/${scene.book}`).promise;
    if (gen !== loadGeneration) return;
    totalBookPages  = pdf.numPages;

    let text = await extractText(pdf, scene.startPage, scene.endPage);
    if (gen !== loadGeneration) return;
    allSentences    = parseSentences(text);

    if (scene.startFrom) {
      let found = false;
      allSentences = allSentences.map(para => {
        if (found) return para;
        let si = para.findIndex(s => s.includes(scene.startFrom));
        if (si === -1) return [];
        found = true;
        return para.slice(si);
      }).filter(p => p.length > 0);
    }

    renderSentences(allSentences);
    updateReadingProgress(scene.startPage);

    loadScreenEl.style.display = 'none';
    readerEl.style.display     = 'flex';

    startAdvancing();

  } catch (error) {
    console.error(error);
    setLoadStatus('Error: ' + error.message);
    loadButton.disabled = false;
  }
}

function playCuratedAudio(scene) {
  let baseVol   = 0.4 + (scene.intensity * 0.5);
  let companion = BASE_COMPANIONS[scene.baseFile];

  let howl = new Howl({
    src:    [`assets/audio/base/${scene.baseFile}`],
    loop:   companion ? false : true,
    volume: 0
  });
  currentBase = howl;
  howl.once('load', () => {
    howl.fade(0, baseVol, 2000);
    if (companion) {
      howl.once('end', () => {
        if (currentBase === howl) crossfadeBase(companion, baseVol);
      });
    }
  });
  howl.play();

  if (scene.textureFile) {
    let texVol  = scene.textureVol;
    let texture = new Howl({
      src:    [`assets/audio/textures/${scene.textureFile}`],
      loop:   true,
      volume: 0
    });
    texture.once('load', () => texture.fade(0, texVol, 2000));
    texture.play();
    currentTextures.push(texture);
  }

  applyMoodTint(moodToColor(scene.mood), scene.intensity);
  sendLedToArduino(moodToRgbScaled(moodToColor(scene.mood), scene.intensity, scene.mood));
  let label = scene.textureFile ? ` · ${scene.textureFile.replace(/\d+\.mp3$/i, '').toLowerCase()}` : '';
  setAtmosphereStatus(`${scene.mood}${label}`);
  updateMoodDisplay(scene.mood, scene.textureFile ? fileBaseName(scene.textureFile) : null);
}


// =====================================================
//   TEXT PROCESSING
// =====================================================

async function extractText(pdf, startPage, endPage) {
  let text = '';
  for (let i = startPage; i <= endPage; i++) {
    let page    = await pdf.getPage(i);
    let content = await page.getTextContent();

    // Position-aware joining: only insert a space when there is an actual
    // visual gap between items — fixes pdf letter-spacing
    // artifact caused by joining all items with ' ' unconditionally.
    let pageStr    = '';
    let lastRight  = null;
    let lastY      = null;
    let lineStartX = null; // X of the first item on the current visual line (for indent detection)
    for (let item of content.items) {
      if (!item.str) continue;
      if (lastRight !== null) {
        let gapX  = item.transform[4] - lastRight;
        let gapY  = Math.abs(item.transform[5] - lastY);
        let fSize = Math.max(item.height || 10, 10);
        if (gapY > fSize * 1.5) {
          pageStr   += '\n\n'; // large vertical gap → paragraph break
          lineStartX = item.transform[4];
        } else if (gapY > fSize * 0.5) {
          // New visual line — detect indent-only paragraph break:
          // if this line starts further right than the previous line's start, it's a first-line indent
          if (lineStartX !== null && item.transform[4] > lineStartX + Math.max(fSize * 0.5, 6)) {
            pageStr += '\n\n';
          } else {
            pageStr += ' ';
          }
          lineStartX = item.transform[4];
        } else if (gapX > 1) {
          pageStr += ' ';
        }
      } else {
        lineStartX = item.transform[4]; // first item on the page
      }
      pageStr   += item.str;
      lastRight  = item.transform[4] + (item.width || 0);
      lastY      = item.transform[5];
    }

    pageStr = pageStr.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"); // normalize curly quotes
    pageStr = pageStr.replace(/(\w)-\s(\w)/g, '$1$2'); // fix PDF hyphenation artifacts
    pageStr = pageStr.replace(/(?<=[a-z.!?,;])(\d+|[ivxIVX]+)(?=\s|$)/g, ''); // strip inline footnote refs
    pageStr = pageStr.replace(/\s\*\s/g, '\n\n*\n\n'); // scene break markers
    text += pageStr + '\n\n';
  }
  return text;
}

function parseSentences(text) {
  // Split into paragraph blocks first (page breaks + within-page paragraph gaps)
  let paraBlocks  = text.split(/\n\n+/);
  let titlePrefix = /^((?:[A-Z]+(?:'[A-Z]+)?|\d+)(?:\s+(?:[A-Z]+(?:'[A-Z]+)?|\d+))*\s+)(?=[A-Z][a-z]|[a-z])/;
  let result      = []; // [ [sentence, sentence, ...], [...], ... ]

  for (let para of paraBlocks) {
    para = para.trim();
    if (!para) continue;
    if (para === '*') { result.push(['__SCENE_BREAK__']); continue; } // scene divider
    if (/^\d+\s/.test(para) && para.length > 40) continue; // skip footnote

    let raw           = para.split(/(?<=[.!?]["']?)\s+(?=[A-Z"'])/);
    let paraSentences = [];

    for (let chunk of raw) {
      chunk = chunk.trim();
      // Skip too-short chunks, lowercase starts (mid-sentence fragment), or all-caps blocks (headers/page numbers)
      if ((chunk.length < 20 && !chunk.startsWith('"') && !chunk.startsWith("'")) || /^[a-z]/.test(chunk) || !/[a-z]/.test(chunk)) continue;
      if (chunk.length < 60 && !/[.!?,'"]$/.test(chunk)) continue; // skip chapter titles / unterminated headers

      let m = chunk.match(titlePrefix);
      if (m && m[1].trim().length >= 8) {
        // Strip all-caps drop-cap prefix; keep the body text that follows (may start lowercase, e.g. "IT WAS ON a dreary night...")
        let rest = chunk.slice(m[1].length).trim();
        if (rest.length >= 40) paraSentences.push(rest);
      } else {
        paraSentences.push(chunk);
      }
    }

    if (paraSentences.length > 0) result.push(paraSentences);
  }
  return result;
}

function renderSentences(paragraphs) {
  readerTextEl.innerHTML  = '';
  bookTitleEl.textContent = currentBookName.toUpperCase();

  // Book name as the passage heading
  let header         = document.createElement('div');
  header.className   = 'chapter-header';
  header.textContent = currentBookName;
  readerTextEl.appendChild(header);

  let globalIdx = 0;
  paragraphs.forEach(sentences => {
    if (sentences[0] === '__SCENE_BREAK__') {
      let divider       = document.createElement('div');
      divider.className = 'scene-break';
      readerTextEl.appendChild(divider);
      return;
    }
    let p = document.createElement('p');
    sentences.forEach(sentence => {
      let span         = document.createElement('span');
      span.className   = 'sentence';
      span.dataset.idx = String(globalIdx++);
      span.textContent = sentence + ' ';
      span.addEventListener('click', () => {
        let sentIdx = parseInt(span.dataset.idx);
        let lineIdx = linePositions.findIndex(lp => lp.sentenceIdx === sentIdx);
        if (lineIdx === -1) return;
        currentLineIdx = lineIdx;
        stopAdvancing();
        setActiveLine(lineIdx);
        resumeAdvancing();
      });
      p.appendChild(span);
    });
    readerTextEl.appendChild(p);
  });
}

function updateReadingProgress(currentPage) {
  let percent              = Math.round((currentPage / totalBookPages) * 100);
  readingProgressEl.textContent = `${percent}%`;
  progressFillEl.style.width    = `${percent}%`;
}

function positionStripe(idx) {
  let spans = readerTextEl.querySelectorAll('.sentence');
  if (!spans[idx]) return;

  let span = spans[idx];
  // top relative to #reader-text-container 
  let top  = readerTextEl.offsetTop + span.offsetTop;
  readingStripeEl.style.top = top + 'px';
}


// =====================================================
//   READING CURSOR
// =====================================================

let progInterval = 3500;

function buildLinePositions() {
  let lineH = parseFloat(getComputedStyle(readerTextEl).lineHeight);
  let containerOffset = readerTextEl.offsetTop; // relative to #reader-text-container
  let positions = [];
  readerTextEl.querySelectorAll('.sentence').forEach(span => {
    let numLines    = Math.max(1, Math.round(span.offsetHeight / lineH));
    let sentenceIdx = parseInt(span.dataset.idx);
    for (let i = 0; i < numLines; i++) {
      positions.push({ top: containerOffset + span.offsetTop + i * lineH, sentenceIdx });
    }
  });
  return positions;
}

function startAdvancing() {
  stopAdvancing();
  currentLineIdx     = 0;
  currentSentenceIdx = -1; // force first setActiveLine(0) to always activate paragraph
  requestAnimationFrame(() => {
    linePositions = buildLinePositions();
    setActiveLine(0);
    resumeAdvancing();
  });
}

function resumeAdvancing() {
  advanceTimer = setInterval(() => {
    if (currentLineIdx >= linePositions.length - 1) { stopAdvancing(); return; }
    currentLineIdx++;
    setActiveLine(currentLineIdx);
  }, Math.round(progInterval / speedMultiplier));
}

function stopAdvancing() {
  if (advanceTimer) { clearInterval(advanceTimer); advanceTimer = null; }
}

function setActiveLine(lineIdx) {
  if (!linePositions[lineIdx]) return;
  let { top, sentenceIdx } = linePositions[lineIdx];

  readingStripeEl.style.top = top + 'px';

  if (sentenceIdx !== currentSentenceIdx) {
    currentSentenceIdx = sentenceIdx;
    let spans = readerTextEl.querySelectorAll('.sentence');
    spans.forEach(s => s.classList.remove('active'));
    readerTextEl.querySelectorAll('p.active-para').forEach(p => p.classList.remove('active-para'));
    if (spans[sentenceIdx]) {
      spans[sentenceIdx].classList.add('active');
      spans[sentenceIdx].parentElement.classList.add('active-para');
      spans[sentenceIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function setSpeed(mult) {
  speedMultiplier = mult;
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === mult);
  });
  if (advanceTimer) { stopAdvancing(); resumeAdvancing(); }
}


// =====================================================
//   STATUS HELPERS
// =====================================================

function setLoadStatus(message) {
  loadStatusEl.textContent = message;
}

function setAtmosphereStatus(message) {
  atmosphereStatusEl.textContent = message;
}


// =====================================================
//   AI — ATMOSPHERE ANALYSIS
// =====================================================

async function analyzeAtmosphere(passage) {
  setAtmosphereStatus('Analyzing...');

  let response = await fetch('/api/openai/v1/chat/completions', {
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
          content: `You are a music supervisor for an AI-powered e-reader. Analyze literary passages and select the best background music from the available tracks below.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "baseTrack": "<filename from BASE TRACKS>",
  "textureTrack": "<filename from TEXTURE TRACKS, or null>",
  "mood": "<one of the mood labels>",
  "intensity": 0.7
}

MOOD LABELS (for display only — pick the closest):
contemplative, cozy, enchanted, epic, joyful, melancholy, mysterious, peaceful, ominous, romantic, scary, suspense, whimsical

INTENSITY: 0.3 (quiet, subtle) to 1.0 (overwhelming, climactic)

═══ BASE TRACKS ═══

CONTEMPLATIVE:
- Contemplative.mp3 — solo piano, quiet inner thought, philosophical reflection

COZY / PEACEFUL (all mellow, low tempo — very similar in feel, nearly interchangeable):
- Cozy01.mp3 — warm acoustic, domestic comfort
- Cozy02.mp3 — similar to Cozy01
- Peaceful01.mp3 — gentle, calm, nature at rest

ENCHANTED / HOPEFUL:
- EnchantedAdventure01.mp3 — magical orchestral, wonder and discovery; can also read as hopeful or optimistic
- HopefulStrings01.mp3 — hopeful strings, rising emotion
- HopefulStrings02.mp3 — similar hopeful character
- HopefulStrings03.mp3 — hopeful strings with a romantic warmth; used for Darcy's Proposal

EPIC (Epic01 and Epic02 are similar, interchangeable):
- Epic01.mp3 — full orchestra, heroic and sweeping
- Epic02.mp3 — similar to Epic01

EMOTIONAL / BITTERSWEET:
- Emotional01.mp3 — moving orchestral, bittersweet and tender; used for Mirror of Erised (longing + warmth, NOT pure sadness or grief)

JOYFUL / FESTIVE (PartyCeltic01 and 02 are similar, interchangeable):
- PartyCeltic01.mp3 — Celtic folk, festive celebration, lively
- PartyCeltic02.mp3 — similar to PartyCeltic01

MELANCHOLY:
- Melancholy01.mp3 — strings and piano, genuine grief and loss
- Melancholy02.mp3 — similar to Melancholy01
- Melancholy03.mp3 — sad but touching, more emotionally resonant than 01/02

MYSTERIOUS:
- Mysterious01.mp3 — Harry Potter-style magical mystery; eerie discovery of the unknown, not threatening
- Scary01.mp3 — despite the name, actually sounds mysterious rather than scary; use for mysterious passages, NOT horror

OMINOUS:
- Ominous01.mp3 — pure ambient atmosphere, no melody; use ONLY if no other base track fits
- Ominous02.mp3 — dark, threatening dread; similar feel to ScaryHorror02
- Ominous03.mp3 — oppressive, mournful; used for The Handmaid's Tale (systemic/political dread, not monster-fear)

ROMANTIC:
- RomanticPiano01.mp3 — quiet, sweet, intimate; SHORT track — best for brief, tender, private moments
- RomanticViolin01.mp3 — soaring violin, 19th-century ballroom waltz character
- RomanticQuartet.mp3 — string quartet; similar 19th-century waltz to RomanticViolin01

SCARY / HORROR:
- ScaryHorror02.mp3 — Jaws-like suspenseful dread, atmospheric; similar feel to Ominous02
- ScaryStrings01.mp3 — chaotic, frantic strings with a mad/unhinged edge; used for Alice's Queen of Hearts (madness and chaos, NOT pure terror)
- ScaryStrings02.mp3 — gothic dark orchestral; classic monster-story horror; used for Frankenstein's Creature

SUSPENSE (⚠ very different tempos — do NOT use interchangeably):
- Suspense01.mp3 — SLOW, dark, heavy, brooding dread
- Suspense02.mp3 — HIGH TEMPO, urgent, racing tension; used for Forbidden Forest (lurking danger, something close)

WHIMSICAL:
- Whimsical01.mp3 — chaotic, frantic whimsy, used for Down the Rabbit Hole
- Whimsical02.mp3 — light and playful, used for Tea Party

═══ TEXTURE TRACKS (ambient layer — use null if no clear setting) ═══
- Battle01.mp3 / Battle02.mp3 — clashing swords, battle chaos
- Castle01.mp3 — grand stone hall, reverberant
- CityNight01.mp3 — urban nighttime ambient
- Forest01.mp3 — birdsong, rustling leaves, outdoor woodland
- Garden01.mp3 — gentle garden ambience
- Hearth01.mp3 — fireplace crackling, warm indoors
- Rain01.mp3 — soft rainfall
- ScaryWindTexture.mp3 — ominous moaning wind (pair with ominous/scary bases)
- Storm01.mp3 — thunder and rain, outdoor storm
- StormInterior01.mp3 — storm heard from inside a building
- Tavern01.mp3 — tavern chatter and noise
- TavernLow01.mp3 — quieter tavern background

═══ CURATED EXAMPLES ═══
Alice: Down the Rabbit Hole → { "baseTrack": "Whimsical01.mp3", "textureTrack": "Forest01.mp3", "mood": "whimsical", "intensity": 0.7 }
Alice: Queen of Hearts → { "baseTrack": "ScaryStrings01.mp3", "textureTrack": "Garden01.mp3", "mood": "scary", "intensity": 0.8 }
Alice: Tea Party → { "baseTrack": "Whimsical02.mp3", "textureTrack": "Garden01.mp3", "mood": "whimsical", "intensity": 0.7 }
Frankenstein: Creature Awakens → { "baseTrack": "ScaryStrings02.mp3", "textureTrack": "Storm01.mp3", "mood": "scary", "intensity": 0.9 }
Harry Potter: Mirror of Erised → { "baseTrack": "Emotional01.mp3", "textureTrack": "Hearth01.mp3", "mood": "melancholy", "intensity": 0.75 }
Harry Potter: You're a Wizard → { "baseTrack": "Mysterious01.mp3", "textureTrack": "StormInterior01.mp3", "mood": "mysterious", "intensity": 0.8 }
Harry Potter: Forbidden Forest → { "baseTrack": "Suspense02.mp3", "textureTrack": "Forest01.mp3", "mood": "scary", "intensity": 0.85 }
LOTR: Bilbo's Party → { "baseTrack": "PartyCeltic01.mp3", "textureTrack": "Tavern01.mp3", "mood": "joyful", "intensity": 0.8 }
LOTR: The Battle → { "baseTrack": "Epic01.mp3", "textureTrack": "Battle01.mp3", "mood": "epic", "intensity": 0.9 }
Pride & Prejudice: Darcy's Proposal → { "baseTrack": "HopefulStrings03.mp3", "textureTrack": "Garden01.mp3", "mood": "romantic", "intensity": 0.75 }
Handmaid's Tale: The Wall → { "baseTrack": "Ominous03.mp3", "textureTrack": "CityNight01.mp3", "mood": "ominous", "intensity": 0.8 }`
        },
        {
          role: 'user',
          content: `Analyze this passage:\n\n${passage}`
        }
      ],
      max_tokens: 150,
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

async function triggerAtmosphereAnalysis(idx) {
  if (isAnalyzing) return;
  isAnalyzing = true;
  let btn = document.getElementById('analyze-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  if (analyzeStatusEl) { analyzeStatusEl.style.color = '#666'; analyzeStatusEl.textContent = ''; }
  try {
    let spans      = readerTextEl.querySelectorAll('.sentence');
    let start      = Math.max(0, idx - 2);
    let chunkText  = Array.from(spans).slice(start, start + 6).map(s => s.textContent.trim()).join(' ');
    let atmosphere = await analyzeAtmosphere(chunkText);
    playAtmosphere(atmosphere);
    if (analyzeStatusEl) {
      let label = atmosphere.textureTrack ? ` · ${fileBaseName(atmosphere.textureTrack)}` : '';
      analyzeStatusEl.style.color = '#666';
      analyzeStatusEl.textContent = `✓ ${atmosphere.mood}${label}`;
    }
  } catch (e) {
    console.error('Atmosphere analysis failed:', e);
    setAtmosphereStatus('Analysis failed');
    if (analyzeStatusEl) {
      analyzeStatusEl.style.color = '#884444';
      analyzeStatusEl.textContent = 'Analysis failed — check console';
    }
  } finally {
    isAnalyzing = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze Mood'; }
  }
}


// =====================================================
//   AUDIO
// =====================================================

const VALID_BASE_TRACKS = new Set([
  'Contemplative.mp3',
  'Cozy01.mp3', 'Cozy02.mp3',
  'Emotional01.mp3',
  'EnchantedAdventure01.mp3',
  'Epic01.mp3', 'Epic02.mp3',
  'HopefulStrings01.mp3', 'HopefulStrings02.mp3', 'HopefulStrings03.mp3',
  'Melancholy01.mp3', 'Melancholy02.mp3', 'Melancholy03.mp3',
  'Mysterious01.mp3',
  'Ominous01.mp3', 'Ominous02.mp3', 'Ominous03.mp3',
  'PartyCeltic01.mp3', 'PartyCeltic02.mp3',
  'Peaceful01.mp3',
  'RomanticPiano01.mp3', 'RomanticQuartet.mp3', 'RomanticViolin01.mp3',
  'Scary01.mp3', 'ScaryHorror02.mp3', 'ScaryStrings01.mp3', 'ScaryStrings02.mp3',
  'Suspense01.mp3', 'Suspense02.mp3',
  'Whimsical01.mp3', 'Whimsical02.mp3',
]);

const VALID_TEXTURE_TRACKS = new Set([
  'Battle01.mp3', 'Battle02.mp3',
  'Castle01.mp3', 'CityNight01.mp3',
  'Forest01.mp3', 'Garden01.mp3', 'Hearth01.mp3',
  'Rain01.mp3', 'ScaryWindTexture.mp3',
  'Storm01.mp3', 'StormInterior01.mp3',
  'Tavern01.mp3', 'TavernLow01.mp3',
]);

function playAtmosphere(atmosphere) {
  setAtmosphereStatus('Loading atmosphere...');
  fadeOutCurrentAudio();

  let mood      = atmosphere.mood      || 'mysterious';
  let baseFile  = atmosphere.baseTrack;
  let texFile   = atmosphere.textureTrack || null;
  let intensity = atmosphere.intensity  || 0.7;

  if (!VALID_BASE_TRACKS.has(baseFile)) {
    console.warn('Invalid baseTrack from AI:', baseFile);
    setAtmosphereStatus('Analysis error');
    return;
  }
  if (texFile && !VALID_TEXTURE_TRACKS.has(texFile)) {
    console.warn('Invalid textureTrack from AI:', texFile, '— ignoring');
    texFile = null;
  }

  let baseVolume = 0.4 + (intensity * 0.5);
  let companion  = BASE_COMPANIONS[baseFile];

  let howl = new Howl({
    src:    [`assets/audio/base/${baseFile}`],
    loop:   companion ? false : true,
    volume: baseVolume
  });
  currentBase = howl;
  howl.once('load', () => {
    let randomStart = Math.random() * Math.max(0, howl.duration() - 5);
    howl.seek(randomStart);
    if (companion) {
      howl.once('end', () => {
        if (currentBase === howl) crossfadeBase(companion, baseVolume);
      });
    }
  });
  howl.play();
  console.log('Playing base:', baseFile, 'volume:', baseVolume);

  if (texFile) {
    let texture = new Howl({
      src:    [`assets/audio/textures/${texFile}`],
      loop:   true,
      volume: 0.4
    });
    texture.play();
    currentTextures.push(texture);
    console.log('Playing texture:', texFile);
  }

  applyMoodTint(moodToColor(mood), intensity);
  sendLedToArduino(moodToRgbScaled(moodToColor(mood), intensity, mood));
  let settingLabel = texFile ? ` · ${fileBaseName(texFile)}` : '';
  setAtmosphereStatus(`${mood}${settingLabel}`);
  updateMoodDisplay(mood, texFile ? fileBaseName(texFile) : null);
}

function crossfadeBase(nextFile, targetVol) {
  let oldBase  = currentBase;
  let nextHowl = new Howl({
    src:    [`assets/audio/base/${nextFile}`],
    loop:   BASE_COMPANIONS[nextFile] ? false : true,
    volume: 0
  });
  currentBase = nextHowl;

  nextHowl.once('load', () => {
    if (currentBase !== nextHowl) return; // stale — a newer load took over
    nextHowl.fade(0, targetVol, 2000);
    if (oldBase) {
      oldBase.fade(oldBase.volume(), 0, 2000);
      setTimeout(() => oldBase.stop(), 2020);
    }
    let companion = BASE_COMPANIONS[nextFile];
    if (companion) {
      nextHowl.once('end', () => {
        if (currentBase === nextHowl) crossfadeBase(companion, targetVol);
      });
    }
  });
  nextHowl.play();
}

function fadeOutCurrentAudio() {
  let toStop = [];
  if (currentBase) { toStop.push(currentBase); currentBase = null; }
  currentTextures.forEach(t => toStop.push(t));
  currentTextures = [];
  toStop.forEach(h => { h.fade(h.volume(), 0, 2000); setTimeout(() => h.stop(), 2020); });
}

function stopAllAudio() {
  stopAdvancing();
  fadeOutCurrentAudio();
  isPaused = false;
  document.getElementById('pause-btn').textContent = 'Pause';
}

function togglePause() {
  isPaused = !isPaused;
  if (isPaused) {
    if (currentBase) currentBase.pause();
    currentTextures.forEach(t => t.pause());
    stopAdvancing();
  } else {
    if (currentBase) currentBase.play();
    currentTextures.forEach(t => t.play());
    resumeAdvancing();
  }
  document.getElementById('pause-btn').textContent = isPaused ? 'Resume' : 'Pause';
}

// keep for backward compatibility (if any old calls exist)
function toggleMute() {
  setMuted(!isMuted);
}


// =====================================================
//   MOOD COLOR + UI TINT
// =====================================================

function moodToColor(mood) {
  const colorMap = {
    'contemplative': '#6b6bf5',  // royal blue
    'cozy':          '#f8ab4c',  // amber
    'enchanted':     '#9370DB',  // medium purple
    'epic':          '#B8860B',  // dark gold
    'joyful':        '#ebe951',  // yellow
    'melancholy':    '#1D4ED8',  // deep blue
    'mysterious':    '#6B21A8',  // deep purple
    'peaceful':      '#76d398',  // forest green
    'ominous':       '#373495',  // dark indigo
    'romantic':      '#f268a1',  // deep rose
    'scary':         '#ba0909',  // deep red
    'suspense':      '#0F766E',  // dark teal
    'whimsical':     '#d25cf6'   // violet/purple
  };
  return colorMap[mood] || '#888888';
}

function fileBaseName(filename) {
  let m = filename.match(/^([A-Z][a-z]+)/);
  return m ? m[1].toLowerCase() : filename.replace(/\d+\.mp3$/i, '').toLowerCase();
}

function updateMoodDisplay(mood, setting) {
  if (!moodDisplayEl) return;
  let hex         = moodToColor(mood);
  let settingLine = setting ? `<span class="mood-setting">${setting}</span>` : '';
  moodDisplayEl.innerHTML = `<span class="mood-dot" style="background:${hex}"></span>${mood}${settingLine}`;
}

function applyMoodTint(hexColor, intensity) {
  let opacity = 0.05 + (intensity * 0.15);
  readingStripeEl.style.backgroundColor = hexToRgba(hexColor, opacity);
}

function hexToRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const MOOD_PATTERN = {
  melancholy: 'calm', ominous: 'calm',
  mysterious: 'medium', romantic: 'medium',
  whimsical: 'intense', joyful: 'intense', scary: 'intense', epic: 'intense'
};

function moodToRgbScaled(hex, intensity, mood) {
  let r = Math.round(parseInt(hex.slice(1, 3), 16));
  let g = Math.round(parseInt(hex.slice(3, 5), 16));
  let b = Math.round(parseInt(hex.slice(5, 7), 16));
  const level = MOOD_PATTERN[mood] || 'medium';
  const payload = { cmd: 'set_rgb', r, g, b, intensity: parseFloat(intensity.toFixed(3)), duration_ms: 0, msg_id: ++serialMsgId };
  if (level === 'intense') {
    payload.auto_cycle = true;
    payload.speed = 1.6;
  } else if (level === 'medium') {
    payload.auto_cycle = true;
    payload.speed = 1.0;
  } else {
    payload.pattern = 1;
    payload.speed = 0.4;
  }
  return JSON.stringify(payload);
}


// =====================================================
//   WEB SERIAL CONNECTION
// =====================================================

async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    try { await port.close(); } catch {} // clean up if stuck open from previous session
    await port.open({ baudRate: 115200 });
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });

    writer = port.writable.getWriter();

    readFromArduino(); 

    arduinoConnected = true;
    loadScreenEl.style.display = 'none';
    console.log('Arduino connected!');
  } catch (err) {
    console.error('Serial connection failed:', err);
    setLoadStatus?.('Connection failed');
  }
}

async function readFromArduino() {
  const decoder = new TextDecoder();
  reader = port.readable.getReader();

  let rxBuffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      rxBuffer += decoder.decode(value, { stream: true });
      const lines = rxBuffer.split(/\r?\n/);
      rxBuffer = lines.pop() || '';

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        console.log('[SERIAL]', line);

        if (!line.startsWith('{')) continue;

        try {
          const msg = JSON.parse(line);

          if (msg.event === 'pc_led_gate') {
            const prev = pcLedGateEnabled;
            pcLedGateEnabled = !!msg.enabled;
            console.log('[GATE]', pcLedGateEnabled);
            if (!prev && pcLedGateEnabled && lastLedPayload) {
              sendToArduino(lastLedPayload);
              console.log('[GATE] re-sent last LED payload');
            }
          }

          if (msg.event === 'mute_state') {
            setMuted(!!msg.muted);
            console.warn('[MUTE]', !!msg.muted);
          }
        } catch (e) {
          console.warn('Failed to parse JSON from Arduino:', line, e);
        }
      }
    }
  } catch (e) {
    console.error('readFromArduino error:', e);
  } finally {
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
    try { await port?.close(); } catch {}
    arduinoConnected = false;
    writer = null;
    reader = null;
    port   = null;
    // Auto-retry after 4s — gives ESP32 time to finish resetting + calibration
    if (loadScreenEl) {
      loadScreenEl.style.display = 'flex';
      let secs = 4;
      const countdown = setInterval(() => {
        setLoadStatus(`Arduino reset detected — reconnecting in ${secs}s...`);
        secs--;
        if (secs < 0) {
          clearInterval(countdown);
          connectSerial();
        }
      }, 1000);
      setLoadStatus(`Arduino reset detected — reconnecting in ${secs}s...`);
    }
  }
}

function setMuted(muted) {
  isMuted = !!muted;
  Howler.mute(isMuted);
  if (currentBase) currentBase.mute(isMuted);
  currentTextures.forEach(t => t.mute(isMuted));
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = isMuted ? 'Unmute' : 'Mute';
}

// Send LED command and remember it so we can re-send instantly when gate turns ON
async function sendLedToArduino(data) {
  // data is expected to be a JSON string like {cmd:'set_rgb',...}
  lastLedPayload = String(data);
  return sendToArduino(lastLedPayload);
}

async function sendToArduino(data) {
  if (!writer) return;
  try {
    await writer.write(new TextEncoder().encode(String(data) + '\n'));
    console.log('Sent to Arduino:', data);
  } catch (err) {
    console.error('Write error:', err);
  }
}