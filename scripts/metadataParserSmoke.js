const { MetadataController } = require('../src/main/metadataController');
const { extractValidMetadataCandidates } = require('../src/main/metadataVisibleJsonPatch');

const controller = new MetadataController({ sessions: {}, projects: {} });

const promptSchema = '{"title":"...","mainTag":"...","supportingTags":["..."],"description":"...","optimizationMode":"POD WINNER"}';
const chatgptResponse = '{"title":"Pink Out Football Breast Cancer Awareness Tackle Cancer Design","mainTag":"pink out football breast cancer awareness","supportingTags":["tackle breast cancer football","breast cancer awareness football","pink football awareness design","breast cancer support gift","football cancer awareness shirt","breast cancer awareness month","October breast cancer awareness","breast cancer fighter support","breast cancer survivor gift","football mom awareness gift","football player pink out","pink ribbon football design","cancer awareness sports design","support breast cancer football"],"description":"Bold Pink Out football design featuring a powerful football player revealing a pink breast cancer awareness ribbon with the message Tackle Breast Cancer. A meaningful sports-themed design for football fans, families, fighters, survivors, supporters, and Breast Cancer Awareness Month events in October.","optimizationMode":"POD WINNER"}';

const conversation = `User prompt schema:\n${promptSchema}\nAssistant response:\n${chatgptResponse}`;
const candidates = extractValidMetadataCandidates(controller, conversation);

if (candidates.length !== 1) throw new Error(`Expected exactly one valid metadata response, found ${candidates.length}.`);
const metadata = candidates[0].metadata;
if (metadata.title !== 'Pink Out Football Breast Cancer Awareness Tackle Cancer Design') throw new Error('Title was not parsed correctly.');
if (metadata.mainTag !== 'pink out football breast cancer awareness') throw new Error('Main Tag was not parsed correctly.');
if (metadata.supportingTags.length !== 14) throw new Error(`Expected 14 supporting tags, found ${metadata.supportingTags.length}.`);
if (!metadata.description.includes('Bold Pink Out football design')) throw new Error('Description was not parsed correctly.');
if (metadata.optimizationMode !== 'POD WINNER') throw new Error('optimizationMode was not normalized correctly.');

console.log('Metadata parser smoke check passed.');
