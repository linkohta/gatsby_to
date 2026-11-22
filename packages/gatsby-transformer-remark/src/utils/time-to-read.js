const sanitizeHTML = require(`sanitize-html`)
const _ = require(`lodash`)

// 漢字（中国語）と、ひらがな、カタカナ（日本語）の Unicode の範囲
const cjRanges = [
  [11904, 11930], // 漢字
  [11931, 12020],
  [12032, 12246],
  [12293, 12294],
  [12295, 12296],
  [12321, 12330],
  [12344, 12348],
  [13312, 19894],
  [19968, 40939],
  [63744, 64110],
  [64112, 64218],
  [131072, 173783],
  [173824, 177973],
  [177984, 178206],
  [178208, 183970],
  [183984, 191457],
  [194560, 195102],
  [12353, 12439], // ひらがな
  [12445, 12448],
  [110593, 110879],
  [127488, 127489],
  [12449, 12539], // カタカナ
  [12541, 12544],
  [12784, 12800],
  [13008, 13055],
  [13056, 13144],
  [65382, 65392],
  [65393, 65438],
  [110592, 110593],
]

function isCjChar(char) {
  const charCode = char.codePointAt(0)
  return cjRanges.some(([from, to]) => charCode >= from && charCode < to)
}

export const timeToRead = html => {
  let timeToRead = 0
  const pureText = sanitizeHTML(html, { allowedTags: [] })
  const avgWPM = 265

  const latinChars = []
  const cjChars = []

  for (const char of pureText) {
    if (isCjChar(char)) {
      cjChars.push(char)
    } else {
      latinChars.push(char)
    }
  }

  // 非ラテン文字の文字列の長さに 0.56 を掛ける。
  // 中国語でも日本語でも、1 語は平均して 2 文字で構成されるためである
  const wordCount = _.words(latinChars.join(``)).length + cjChars.length * 0.56

  timeToRead = Math.round(wordCount / avgWPM)
  if (timeToRead === 0) {
    timeToRead = 1
  }
  return timeToRead
}
