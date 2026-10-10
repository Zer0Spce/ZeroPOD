// Conservative Research safety screen for obvious branded/licensed designs.
// This is not a legal trademark registry and does not claim legal clearance.
// It intentionally prefers skipping obvious IP/brand properties before Automation.

const EXPLICIT_LICENSE_RE = /\b(?:officially\s+licensed|official\s+merch(?:andise)?|licensed\s+(?:merch(?:andise)?|apparel|t-?shirt|tee|hoodie)|authentic\s+licensed)\b/i;

const PROPERTY_PATTERNS = [
  // Entertainment / characters / publishing
  ['disney', /\b(?:disney|mickey\s+mouse|minnie\s+mouse|frozen|lilo\s*(?:&|and)\s*stitch|stitch)\b/i],
  ['marvel', /\b(?:marvel|avengers|spider-?man|iron\s+man|captain\s+america|deadpool|wolverine|guardians\s+of\s+the\s+galaxy)\b/i],
  ['star-wars', /\b(?:star\s+wars|darth\s+vader|mandalorian|grogu|baby\s+yoda|jedi|sith)\b/i],
  ['dc-comics', /\b(?:dc\s+comics|batman|superman|wonder\s+woman|harley\s+quinn|the\s+flash|aquaman)\b/i],
  ['harry-potter', /\b(?:harry\s+potter|hogwarts|gryffindor|slytherin|hufflepuff|ravenclaw)\b/i],
  ['dr-seuss', /\b(?:dr\.?\s*seuss|thing\s*[12]|cat\s+in\s+the\s+hat|grinch|lorax)\b/i],
  ['peanuts', /\b(?:peanuts|snoopy|charlie\s+brown|woodstock)\b/i],
  ['sanrio', /\b(?:sanrio|hello\s+kitty|kuromi|my\s+melody|cinnamoroll|gudetama)\b/i],
  ['sesame-street', /\b(?:sesame\s+street|elmo|cookie\s+monster|big\s+bird)\b/i],
  ['barbie', /\b(?:barbie|ken\s+doll|mattel)\b/i],
  ['lego', /\b(?:lego|legoland)\b/i],

  // Games / consoles
  ['pokemon', /\b(?:pok[eé]mon|pikachu|charizard|squirtle|bulbasaur)\b/i],
  ['nintendo', /\b(?:nintendo|super\s+mario|mario\s+kart|zelda|legend\s+of\s+zelda|kirby|animal\s+crossing)\b/i],
  ['sonic', /\b(?:sonic\s+the\s+hedgehog|sega)\b/i],
  ['minecraft', /\b(?:minecraft|creeper)\b/i],
  ['fortnite', /\bfortnite\b/i],
  ['roblox', /\broblox\b/i],
  ['playstation', /\b(?:playstation|ps5|ps4)\b/i],
  ['xbox', /\bxbox\b/i],

  // Sports leagues / licensed team ecosystems
  ['nfl', /\b(?:nfl|national\s+football\s+league|super\s+bowl)\b/i],
  ['nba', /\b(?:nba|national\s+basketball\s+association)\b/i],
  ['mlb', /\b(?:mlb|major\s+league\s+baseball)\b/i],
  ['nhl', /\b(?:nhl|national\s+hockey\s+league)\b/i],
  ['ncaa', /\b(?:ncaa|march\s+madness)\b/i],
  ['fifa', /\b(?:fifa|uefa|champions\s+league)\b/i],

  // Well-known consumer / apparel / media brands
  ['nike', /\bnike\b/i],
  ['adidas', /\badidas\b/i],
  ['coca-cola', /\b(?:coca[-\s]?cola|coke)\b/i],
  ['pepsi', /\bpepsi\b/i],
  ['starbucks', /\bstarbucks\b/i],
  ['amazon-brand', /\b(?:amazon\s+prime|prime\s+video|alexa)\b/i],
  ['netflix', /\bnetflix\b/i],

  // Music / celebrity brands where merch is commonly rights-controlled
  ['taylor-swift', /\btaylor\s+swift\b/i],
  ['bts', /\bBTS\b/],
  ['blackpink', /\bblackpink\b/i]
];

function assessTrademarkRisk(item = {}) {
  const title = String(item.title || '').trim();
  const brand = String(item.brand || '').trim();
  const category = String(item.category || '').trim();
  const text = [title, brand, category].filter(Boolean).join(' · ');

  if (!text) return { risky: false, reason: null, matched: null };

  if (EXPLICIT_LICENSE_RE.test(text)) {
    return { risky: true, reason: 'explicitly-licensed-or-official-merch', matched: 'licensed/official merchandise wording' };
  }

  for (const [id, pattern] of PROPERTY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { risky: true, reason: `known-brand-or-property:${id}`, matched: match[0] };
  }

  return { risky: false, reason: null, matched: null };
}

module.exports = { assessTrademarkRisk, EXPLICIT_LICENSE_RE, PROPERTY_PATTERNS };
