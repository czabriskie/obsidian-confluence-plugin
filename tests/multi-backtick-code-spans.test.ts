import { describe, it, expect } from "vitest";
import { markdownToConfluenceStorage } from "../src/converter";

/**
 * Regression test for a real Confluence 500 error:
 *   com.atlassian.confluence.content.render.xhtml.XhtmlException:
 *   Unhandled element type 'code'
 *
 * Root cause: a naive single-backtick inline-code regex mis-parses
 * double/quadruple-backtick spans (used so the code text can itself contain
 * a literal backtick), causing a runaway match that swallows unrelated
 * later content — including real fenced code blocks — producing
 * mismatched/corrupted storage-format markup.
 */
describe("multi-backtick inline code spans (regression)", () => {
    /** Simple tag-balance checker: every open tag must have a matching close, in order. */
    function assertTagsBalanced(xml: string) {
        const stack: string[] = [];
        const tagRegex = /<\/?([a-zA-Z][\w:.-]*)[^>]*>/g;
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(xml)) !== null) {
            const [tag, name] = match;
            if (tag.endsWith("/>")) continue; // self-closing
            if (tag.startsWith("</")) {
                expect(stack.pop(), `unexpected closing </${name}> in:\n${xml}`).toBe(name);
            } else {
                stack.push(name);
            }
        }
        expect(stack, `unclosed tags remain in:\n${xml}`).toEqual([]);
    }

    it("produces balanced, correct markup for the reported note content", () => {
        const md = [
            "# Notes",
            "- Getting the org id was a pain to set up the s3 buckets.",
            "\t- ````ZJHZZPJWPFATDO73HXVPSYBCY4```` for factory-test-cam",
            "\t- Compute the short org ID",
            "- I figured out what happened to the ``converter-lambda-runtime`` It was in the verification bucket. Makes sense",
            "```bash",
            "aws s3api put-object --bucket example --key converters/",
            "```",
            "- The key fields are:",
            "\t- `bucket`: the S3 bucket (verification bucket)",
        ].join("\n");

        const result = markdownToConfluenceStorage(md);

        assertTagsBalanced(result);
        expect(result).toContain("<code>ZJHZZPJWPFATDO73HXVPSYBCY4</code>");
        expect(result).toContain("<code>converter-lambda-runtime</code>");
        expect(result).toContain("<code>bucket</code>");
        // The real fenced bash block must still convert to its own macro.
        expect(result).toContain('ac:name="code"');
        expect(result).toContain("<![CDATA[aws s3api put-object");
    });
});
