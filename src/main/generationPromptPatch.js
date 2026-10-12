const { ChatGPTController } = require('./chatgptController');

const GENERATION_PROMPT = `-Copy slogan and create a style
-make It Clean and Print On demand Friendly
-avoid using specific colors and elements from last output unless i told you
-make sure that the font styling is different
-add some few elements. but don't add too much
-make the text Large Easy To Read
-Don't Use Cursive text unless defined.
-avoid adding element's on text
-make sure that the text are large and uniformed
-Avoid Using Ribbons
-don't do that fake transparent background. i want real transparent background
-make sure to add black stroke on the design
-make output 4:5
-Don't USE AI Brush Text
-DON'T ADD TEXT IF THE REFERENCE DOESN'T HAVE ONE.
-DONT USE BLACK TEXT OR ELEMENTS
-MAKE TEXT LARGE AND BIG. 
-IF THE reference is only text. add some few elements based on the text`;

ChatGPTController.prototype.buildPrompt = function buildPromptUpdatedZeroPODBaseline() {
  return GENERATION_PROMPT;
};

module.exports = { GENERATION_PROMPT };
