import { readFileSync } from 'node:fs';
export const SAMPLE_CSV = `gsc,best l1 blockchain for payments,880
gsc,vanar chain vs base,320
support_chat,how do I migrate my VANRY tokens,210
sales_call,is Vanar legitimate,140
gsc,where can I buy VANRY,260
community,vanar chain transaction fees,180`;
export function extractorEval(path = 'docs/extractor-eval.json'): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
