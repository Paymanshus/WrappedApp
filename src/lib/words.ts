// Words for stats: one tokenizer and one stop list, shared by signature words, shared
// vocabulary and trends. Stop words are grammar (English + common Hinglish), never slang:
// "yaar", "bro", "acha" are exactly what vocabulary stats should surface.

export const STOP = new Set(('the a an and or but if then else for to of in on at by with from as is are was were be been ' +
  'am i you he she it we they me him her us them my your his its our their this that these those there here ' +
  'not no yes ok okay so do does did done have has had will would can could should shall may might must ' +
  'what when where who whom whose why how which just really very too also all any some more most other ' +
  'u ur im ill ive dont cant wont didnt isnt arent thats whats its lets gonna wanna gotta lol haha hahaha hmm hm oh ah ' +
  'ha na nah yeah yep nope like get got go going one two even now know see well say said out up down about because ' +
  'omitted media message deleted attached file null http https www com edited ' +
  // Hinglish grammar words (romanised): particles, pronouns, auxiliaries, postpositions
  'hai hain ho hoga hogi tha thi the ka ki ke ko se mein mai main toh bhi nahi nai kya kyu kyun kab kaise kaha ' +
  'kar kr karo raha rahi rahe hi ye yeh wo woh vo aur par pe ek ab sab kuch koi tu tum aap hum mera meri mere tera ' +
  'teri tere uska uski unka unki apna apni hum kis isko usko mujhe tujhe tumhe humein jo jab tab abhi bas'
).split(/\s+/))

/** Content words of a message: lowercased, 3+ letters, no stop words, no numbers. */
export function contentWords(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
}

/** Rough word count (whitespace tokens), the denominator for "uses per 1,000 words". */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * Everyday English content words. Not stop words (they stay in signature words), but shared-
 * vocabulary ranking pushes them down so the list shows what's *yours*: slang, catchphrases,
 * nicknames, in-jokes ("yaar", "scene", "chai") rather than "time" and "tomorrow".
 */
export const EVERYDAY = new Set(('time today tomorrow tonight yesterday morning night day days week weekend month year ' +
  'good great nice fine bad best better sure right wrong way thing things something nothing anything everything ' +
  'want need make made take took give gave come came back still much many little lot lots tell told think thought ' +
  'feel felt look looks looking wait send sent call called work home people person place first last next ' +
  'new old long little big again always never maybe probably actually literally though thanks thank sorry please ' +
  'happy love miss later soon already today tmrw tmr plan plans meet eat food talk text phone yes yess done free ' +
  'start end try trying let help keep put stop find found read watch play went leave left stay coming getting ' +
  'doing being having saying making taking anyone someone everyone guys man today hour hours minutes min mins ' +
  'reached reach okk okay alright cool fun true real only same different every each another such own').split(/\s+/))
