import { describe, it } from "vitest";
import { markdownToConfluenceStorage } from "../src/converter";
import fs from "fs";
import path from "path";

describe("Integration Factory Practice.md converter debug", () => {
    it("converts the problematic file and reports issues", () => {
        const filePath = "/Users/cameronzabriskie/Vaults/ZONTAL/1 Projects/Learning and Sharing/Integration Factory Practice/Integration Factory Practice.md";
        const content = fs.readFileSync(filePath, "utf-8");
        
        const storage = markdownToConfluenceStorage(content);
        
        // Write output for inspection
        fs.writeFileSync("/tmp/integration-factory-storage.html", storage);
        console.log("\n✅ Conversion successful");
        console.log(`Output: /tmp/integration-factory-storage.html (${storage.length} chars)`);
        
        // Look for potentially problematic inline <code> elements
        const codeMatches = storage.match(/<code[^>]*>.*?<\/code>/gs) || [];
        console.log(`\n📝 Inline <code> elements: ${codeMatches.length}`);
        if (codeMatches.length > 0) {
            console.log("   Examples:");
            codeMatches.slice(0, 5).forEach((match, i) => {
                console.log(`     ${i + 1}. ${match.substring(0, 100)}`);
            });
        }
        
        // Look for code macros
        const macroMatches = storage.match(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<\/ac:structured-macro>/g) || [];
        console.log(`\n📦 Code macros: ${macroMatches.length}`);
        if (macroMatches.length > 0) {
            console.log("   First few:");
            macroMatches.slice(0, 3).forEach((match, i) => {
                const truncated = match.substring(0, 150).replace(/\n/g, " ");
                console.log(`     ${i + 1}. ${truncated}...`);
            });
        }
        
        // Check for malformed elements
        const hasMismatchedTags = (text: string) => {
            const stack: string[] = [];
            const tagRegex = /<\/?(\w+)[^>]*>/g;
            let match;
            while ((match = tagRegex.exec(text)) !== null) {
                const [tag, name] = match;
                if (tag.startsWith("</")) {
                    if (stack.length === 0 || stack[stack.length - 1] !== name) {
                        return { bad: true, stack, tag, name };
                    }
                    stack.pop();
                } else if (!tag.endsWith("/>")) {
                    stack.push(name);
                }
            }
            return { bad: stack.length > 0, stack };
        };
        
        const tagCheck = hasMismatchedTags(storage);
        console.log(`\n🔍 Tag balance check: ${tagCheck.bad ? "⚠️  Potential mismatch" : "✅ Balanced"}`);
        if (tagCheck.bad) {
            console.log(`   Unclosed tags: ${JSON.stringify(tagCheck.stack)}`);
        }
    });
});
