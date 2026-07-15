/**
 * INPUT QUALITY SCORING
 * 
 * The gatekeeper that teaches the system to say "this is garbage"
 */

export interface InputSignals {
  keywordHits: number;
  ambiguity: number;
  length: number;
  noise: number;
  qualityScore: number;
  detectedIntents: { [key: string]: number };
  uncertainty: number;
}

export function scoreInputQuality(input: string): number {
  if (!input || input.trim().length === 0) return 0;

  let score = 1;

  // Too short
  if (input.length < 5) score -= 0.4;

  // Special characters spam
  const specialCharCount = (input.match(/[^a-zA-Z0-9\s.,?!$]/g) || []).length;
  if (specialCharCount > input.length * 0.3) score -= 0.2;

  // Repetitive spam (aaaaaa, testtesttest)
  if (/(.)\1{5,}/.test(input)) score -= 0.3;

  // Mostly noise (high ratio of non-meaningful chars)
  const noiseChars = (input.match(/[^\w\s]/g) || []).length;
  if (noiseChars > input.length * 0.4) score -= 0.2;

  return Math.max(0, score);
}

export function analyzeInputSignals(input: string): InputSignals {
  const lower = input.toLowerCase();

  // Keyword detection
  const financialKeywords = ["money", "revenue", "profit", "income", "financial", "budget", "cost", "price"];
  const technicalKeywords = ["build", "deploy", "code", "api", "system", "server", "database"];
  const operationalKeywords = ["task", "run", "status", "monitor", "process", "workflow"];
  const conversationalKeywords = ["tell", "about", "your", "day", "feel", "think", "help"];

  // Uncertainty indicators
  const uncertaintyKeywords = ["maybe", "perhaps", "possibly", "might", "could", "sort of", "kind of", "probably"];

  const detectedIntents: { [key: string]: number } = {};

  // Count keyword hits per intent
  detectedIntents.financial = financialKeywords.filter(kw => lower.includes(kw)).length;
  detectedIntents.technical = technicalKeywords.filter(kw => lower.includes(kw)).length;
  detectedIntents.operational = operationalKeywords.filter(kw => lower.includes(kw)).length;
  detectedIntents.conversational = conversationalKeywords.filter(kw => lower.includes(kw)).length;

  const keywordHits = Object.values(detectedIntents).reduce((sum, count) => sum + count, 0);

  // Ambiguity: multiple intents with significant hits
  const significantIntents = Object.values(detectedIntents).filter(count => count > 0).length;
  const ambiguity = significantIntents > 1 ? 0.5 : 0;

  // Uncertainty: presence of uncertainty indicators
  const uncertaintyHits = uncertaintyKeywords.filter(kw => lower.includes(kw)).length;
  const uncertainty = uncertaintyHits > 0 ? 0.3 : 0;

  // Noise: non-alphanumeric characters
  const noise = (input.match(/[^a-zA-Z0-9\s]/g) || []).length / input.length;

  return {
    keywordHits,
    ambiguity,
    length: input.length,
    noise,
    qualityScore: scoreInputQuality(input),
    detectedIntents,
    uncertainty
  };
}
