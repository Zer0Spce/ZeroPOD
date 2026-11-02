const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {MetadataController}=require('../src/main/metadataController');
const {validateMetadata}=require('../src/main/qualityControl');

const controller=new MetadataController({sessions:{},projects:{}});
const prompt=controller.buildPrompt({sourceUrl:'https://www.amazon.com/dp/B000TEST'});
for(const clause of [
  'TITLE SEO 2.0', 'TAG SEO 2.0', '45–60 characters', '6–9',
  'T-Shirt', 'maximum 50 characters per tag', 'ordered from most relevant to least'
]){
  assert(prompt.includes(clause), 'Missing title/tag SEO guideline: '+clause);
}
// The description prompt, JSON field and normalization workflow are unchanged.
assert(prompt.includes('- Description: short, natural, persuasive, and readable; explain what the design is and who it is for while naturally using the main niche language.'));
assert(prompt.includes('  "description": "...",'));

const tags=[
  'bluegill fishing','freshwater fishing','panfish','angler','fish lover',
  'bluegill hunter','lake fishing','fishing humor','outdoor hobby',
  'fishing illustration','retro fish art','sunfish','lakeside','fishing trip'
];
const originalDescription='Keep this EXISTING description exactly as authored; do not change me.';
const record={
  title:'Vintage Bluegill Hunter Freshwater Fishing',
  mainTag:'bluegill',
  supportingTags:tags,
  description:originalDescription,
  optimizationMode:'POD WINNER'
};
const normalized=controller.normalizeMetadataObject(record);
assert.strictEqual(normalized.description,originalDescription);
assert.strictEqual(normalized.mainTag,record.mainTag);
assert.deepStrictEqual(normalized.supportingTags,tags);
assert.strictEqual(normalized.title,record.title);
assert.strictEqual(validateMetadata(normalized).ok,true);
assert.strictEqual(validateMetadata(normalized).metadata.description,originalDescription);

assert.throws(
 ()=>controller.normalizeMetadataObject({...record,mainTag:'A'.repeat(51)}),
 /50-character/
);
assert.throws(
 ()=>controller.normalizeMetadataObject({...record,supportingTags:[...tags.slice(0,13),'B'.repeat(51)]}),
 /50-character/
);
const longTags={...record,mainTag:'C'.repeat(51)};
assert(validateMetadata(longTags).errors.some(e=>e.includes('50-character')));
const badTitle=validateMetadata({...record,title:'Bluegill Fishing Shirt Retro Design Graphic Design'});
assert(badTitle.warnings.some(e=>e.includes('product types')));
assert(badTitle.warnings.some(e=>e.includes('generic title padding')));
assert(!badTitle.errors.some(e=>e.toLowerCase().includes('description')));
assert.throws(
 ()=>controller.normalizeMetadataObject({...record,supportingTags:tags.slice(0,13)}),
 /14 unique/
);
const source=fs.readFileSync(path.join(__dirname,'../src/main/metadataController.js'),'utf8');
assert(source.includes('Keep the description unchanged from your previous response.'));
console.log('Redbubble Title/Tag SEO 2.0: title guidance, 15 tags, 50-char limit, description unchanged: OK');
