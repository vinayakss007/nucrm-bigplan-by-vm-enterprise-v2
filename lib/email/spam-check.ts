/**
 * D1: Spam Score Check
 *
 * Local spam analysis for email content — flags trigger words, caps, exclamation
 * abuse, link ratios, and low-text content without calling external APIs.
 */

export enum SpamVerdict {
  CLEAN = 'clean',
  SUSPICIOUS = 'suspicious',
  BLOCKED = 'blocked',
}

interface SpamCheckInput {
  subject: string;
  body: string;
  fromName: string;
}

interface SpamCheckResult {
  verdict: SpamVerdict;
  score: number;
  flags: string[];
}

const SPAMMY_WORDS = [
  'free money', 'act now', 'limited time', 'buy now', 'risk-free',
  'no obligation', 'click here', 'claim your prize', 'congratulations',
  'you won', 'free', 'winner', 'urgent', 'dear friend', 'earn extra',
  'double your', 'make money', 'fast cash', 'guarantee', 'no cost',
  'apply now', 'below market', 'call now', 'cancel', 'compare',
  'credit offer', 'discount', 'do it today', 'exclusive deal',
  'fantastic offer', 'for free', 'get it now', 'great offer',
  'incredible deal', 'lowest price', 'miracle', 'obligation',
  'offer expires', 'once in a lifetime', 'order now', 'pennies',
  'potential earning', 'promise', 'pure profit', 'satisfaction',
  'special promotion', 'take action', 'this isn\'t spam',
  'top rated', 'unlimited', 'what are you waiting for',
];

const MINOR_SPAMMY_WORDS = [
  'opportunity', 'info', 'subscribe', 'opt in',
];

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function linkCount(text: string): number {
  return (text.match(/https?:\/\//g) || []).length;
}

function exclamationCount(text: string): number {
  return (text.match(/!/g) || []).length;
}

function checkCapsWords(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  return words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w)).length;
}

export function checkSpam(input: SpamCheckInput): SpamCheckResult {
  const { subject, body } = input;
  const fullText = `${subject} ${body}`.toLowerCase();
  let score = 0;
  const flags: string[] = [];

  // Check ALL CAPS in subject (3+ uppercase words = flag)
  const capsCount = checkCapsWords(subject);
  if (capsCount >= 3) {
    flags.push('caps_subject');
    score += 2;
  }

  // Excessive exclamation marks (3+ in subject, 5+ in body+subject)
  const subjectExcl = exclamationCount(subject);
  const totalExcl = exclamationCount(fullText);
  if (subjectExcl >= 3) {
    flags.push('excessive_exclamation');
    score += 2;
  } else if (totalExcl >= 5) {
    flags.push('excessive_exclamation');
    score += 1;
  }

  // Spammy trigger words
  const matchedWords = SPAMMY_WORDS.filter(w => fullText.includes(w));
  if (matchedWords.length > 0) {
    flags.push('spammy_words');
    score += Math.min(matchedWords.length, 5);
  }

  // Minor spammy words
  const minorMatches = MINOR_SPAMMY_WORDS.filter(w => fullText.includes(w));
  if (minorMatches.length >= 2) {
    flags.push('minor_spammy_words');
    score += minorMatches.length;
  }

  // High link ratio (>1 link per 50 words)
  const words = countWords(fullText);
  const links = linkCount(fullText);
  if (words > 0 && links > 0 && links / words > 1 / 50) {
    flags.push('high_link_ratio');
    score += 2;
  }

  // Low text content (subject-only emails or very short body)
  const bodyWords = countWords(body);
  if (bodyWords < 5) {
    flags.push('low_text_content');
    score += 2;
  }

  // Determine verdict
  let verdict: SpamVerdict;
  if (score >= 7) {
    verdict = SpamVerdict.BLOCKED;
  } else if (score >= 3) {
    verdict = SpamVerdict.SUSPICIOUS;
  } else {
    verdict = SpamVerdict.CLEAN;
  }

  return { verdict, score, flags };
}
