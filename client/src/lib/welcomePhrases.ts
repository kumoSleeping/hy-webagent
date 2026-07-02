/** Empty-state prompts — edit this list to change what appears in new chats. */
export const WELCOME_PHRASES = [
  "如果说结局已经注定，那么今天的舞台就是我们新的开始。",
  "的确，他们不仅是旧时代的落幕更是新时代的奠基者，虽然可能成为优秀的绝唱，但还是把未来留给了后辈。",
  "所谓的「青春系」乐队的情感是复杂多元的，这些「黑暗系」乐队的情感一样是复杂的，不过他们的态度就「凶暴」得多了。",
  "最遥远的距离，说不定就近在咫尺呢，因为远在星辰彼方的你现在，正切实地和我目光相接。",
  "夏末，与你共赏的星空，和汽水瓶的叮咚。",
  "唱着「梦不是梦」的旅途，把青春全都献出去就好。",
  "这拳头也好！这性命也好！皆是 Symphogear！！",
  "没事，完全没问题。因为这个世界还有歌声啊。",
  "吃饭、看电影、睡觉！",
  "把我所有的歌全都献给全世界！",
  "正因为是大人，才更要做梦啊。",
  // 超时空要塞 F
  "爱，你还记得吗",
  "闪一闪！流星 闪一闪！",
  "爱上神明的那时候，从未想过会迎来这样的离别",
  "想活下去，想活下去，还想继续活下去",
  // 超时空要塞 Δ
  "歌是活力！神秘！生命！希望！爱！",
  "乘风就能飞！拼命飞就能飞！！",
  "极限之爱，禁忌的边界线，燃烧的感情",
  "若此生仅此一次恋爱，愿与你心中共舞",
  "Rune 闪闪发光之时，那就是爱的信号",
  "人皆有自己的风而活。岂能将风合而为一！",
] as const;

export type WelcomePhrase = (typeof WELCOME_PHRASES)[number];

export function pickWelcomePhrase(): WelcomePhrase {
  const index = Math.floor(Math.random() * WELCOME_PHRASES.length);
  return WELCOME_PHRASES[index] ?? WELCOME_PHRASES[0];
}
