/**
 * Parses bo3docs.htm from BO3 mod tools and generates bo3-api.json
 * Usage: node scripts/parse-bo3docs.js "path/to/bo3docs.htm"
 */
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2] || "D:\\Stem\\steamapps\\common\\Call of Duty Black Ops III\\docs_modtools\\bo3docs.htm";
const outputPath = path.join(__dirname, "..", "src", "data", "bo3-api.json");

const html = fs.readFileSync(inputPath, "utf-8");

// Split by <HR> to get individual function blocks
// Each block starts with <H1>...</H1> followed by <OL>...</OL>
const blocks = html.split(/<HR>/i).filter(b => b.includes("<H1>"));

const api = {};

for (const block of blocks) {
  try {
    // Extract the H1 content (function signature)
    const h1Match = block.match(/<H1>(.*?)<\/H1>/is);
    if (!h1Match) continue;

    let sig = h1Match[1]
      .replace(/<\/?I>/gi, "")   // remove <I> tags
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

    // Extract callOn entity if present: "void <entity> FuncName(...)"
    let callOn = undefined;
    const callOnMatch = sig.match(/^\w+\s+<([^>]+)>\s+/);
    if (callOnMatch) {
      callOn = callOnMatch[1];
      sig = sig.replace(/<[^>]+>\s+/, ""); // remove the <entity> part
    }

    // Extract function name and full signature
    // Format after cleanup: "returnType FuncName(params)" or "FuncName(params)"
    const funcMatch = sig.match(/(?:\w+\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (!funcMatch) continue;

    const funcName = funcMatch[1];
    const paramsRaw = funcMatch[2].trim();

    // Build fullAPI string
    const fullAPI = `${funcName}(${paramsRaw})`;

    // Extract CATEGORY
    const catMatch = block.match(/<B>CATEGORY:\s*<\/B>(.*?)(?:<BR>|$)/is);
    const category = catMatch ? catMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract CLIENT/SERVER (side)
    const sideMatch = block.match(/<B>CLIENT\/SERVER:\s*<\/B>(.*?)(?:<BR>|$)/is);
    const side = sideMatch ? sideMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract SUMMARY
    const summaryMatch = block.match(/<B>SUMMARY:\s*<\/B>(.*?)(?:<BR>|$)/is);
    const summary = summaryMatch ? summaryMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract EXAMPLE
    const exampleMatch = block.match(/<B>EXAMPLE:\s*<\/B>(.*?)(?:<BR>|$)/is);
    const example = exampleMatch ? exampleMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract mandatory/optional params
    const params = {};
    const paramMatches = block.matchAll(/<LI>\s*<B>\[(MANDATORY|OPTIONAL)\]<\/B>\s*(.*?)(?=<\/UL>|<LI>|$)/gis);
    let mandIdx = 1, optIdx = 1;
    for (const pm of paramMatches) {
      const type = pm[1].toLowerCase();
      const desc = pm[2].replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      if (type === "mandatory") {
        params[`mandatory${mandIdx}`] = desc;
        mandIdx++;
      } else {
        params[`optional${optIdx}`] = desc;
        optIdx++;
      }
    }

    // Build the entry
    const entry = { fullAPI };
    if (callOn) entry.callOn = callOn;
    if (summary) entry.summary = summary;
    if (example) entry.example = example;
    if (side) entry.side = side;
    // Add params
    Object.assign(entry, params);

    // Use funcName as key, skip duplicates (keep first occurrence)
    if (!api[funcName]) {
      api[funcName] = entry;
    }
  } catch (e) {
    // Skip malformed entries
  }
}

// Sort by function name
const sorted = {};
for (const key of Object.keys(api).sort()) {
  sorted[key] = api[key];
}

fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2), "utf-8");

console.log(`Parsed ${Object.keys(sorted).length} functions from bo3docs.htm`);
console.log(`Written to ${outputPath}`);
