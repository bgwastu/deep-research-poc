// deno-lint-ignore-file no-explicit-any
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { Command } from "@cliffy/command";
import { Spinner } from "@topcli/spinner";
import { generateObject, generateText } from "ai";
import "jsr:@std/dotenv/load";
import z from "zod";

// Types
type ResearchType = "web" | "ai";

interface ResearchPlan {
  title: string;
  objectives: string;
  expectedOutcomes: string;
  type: ResearchType;
  query: string;
}

interface WebContent {
  title: string;
  content: string;
  url: string;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

interface ResearchSummary {
  answer: string;
  references: {
    url: string;
    title: string;
  }[];
}

const fastModel = google("gemini-1.5-flash");
const flagshipModel = openai("gpt-4o");

const researchPlanSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the research plan. The good title is the one that can be used to describe the research plan, not adding Research Plan to the title."
    ),
  language: z
    .string()
    .describe(
      "The language of the the research report. The language is based on the language of the query."
    ),
  objectives: z
    .string()
    .describe(
      "The objectives of the research plan. What key questions should be answered?"
    ),
  expectedOutcomes: z
    .string()
    .describe(
      "The expected outcomes of the research plan. What insights, conclusions, or applications do you anticipate?"
    ),
  researchPlan: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            "This is what are you currently researching. Use active voice. Example: Find information on the current status of CBDC development and implementation in Indonesia."
          ),
        objectives: z
          .string()
          .describe(
            "The objectives of the research plan. What key questions should be answered?"
          ),
        expectedOutcomes: z
          .string()
          .describe(
            "The expected outcomes of the research plan. What insights, conclusions, or applications do you anticipate?"
          ),
        type: z
          .enum(["web", "ai"])
          .describe(
            "The type of research plan. If you need to know the information from the web, the type is web. It will be executed by searching on the web. If you don't need to know the information from the web and then it will get the summary of the information from the web, the type is ai. It will be executed by asking the AI."
          ),
        query: z
          .string()
          .describe(
            "The query of the research plan. If the type is web, the query is the search query. If the type is ai, the query is the question to be asked to the AI. For the search query, use the respected language so that the search engine can find the information."
          ),
      })
    )
    .describe(
      `The research plan outlines that each study will be conducted using either web searches or consultations with AI. Please ensure the plan is detailed and comprehensive while maintaining a focused scope. If any aspects of the research appear too broad, please reserve those for consideration in a subsequent research plan.`
    ),
});

const systemPrompt = `You are a deep research assistant tasked with developing a comprehensive research plan based on the following query from the user: ${prompt}. Your goal is to ensure that the user gains a thorough understanding of the subject with high accuracy. 

The system is look like this:
- Research Phase:
    - The system will automatically generate comprehensive information relevant to the topic queried by the user.
    - Information will be gathered through a Web Search, sourcing insights from the top 10 websites, as well as by engaging directly with an advanced AI language model (e.g., utilizing Perplexity).
    - Upon completing the research, the system will summarize the findings in a clear and concise manner.
- Analysis Phase:
    - The summarized information from the research phase will be analyzed by the AI, tailored specifically to address the user's original questions.
    - The analysis will be meticulously assessed and distilled into key points for clarity and focus.
- Reporting Phase:
    - The results of the analysis will be seamlessly integrated to formulate a cohesive article, presenting a well-rounded overview of the topic.
    
You're currently in the Research Phase, and you're tasked with generating a comprehensive research plan based on the following query from the user.`;

async function fetchWebContent(
  url: string,
  spinner: Spinner,
  title: string
): Promise<WebContent | null> {
  spinner.text = `${title}\n   Fetching: ${url}`;
  const res = await fetch(`https://urlparser.maia.id/?url=${url}`);
  if (res.status !== 200) return null;

  const data = await res.json();
  if (!data.content || data.content.length < 100) return null;

  return data as WebContent;
}

async function getRelevantUrls(
  results: SearchResult[],
  research: ResearchPlan,
  spinner: Spinner
) {
  spinner.text = `${research.title}\n - Finding relevant URLs...`;
  const { object: urlRes } = await generateObject({
    model: flagshipModel,
    prompt: `From the following search results, find the most relevant URL that can make sure this objective is achieved: "${
      research.objectives
    }".
Here is the search results:
${JSON.stringify(results)}`,
    schema: z.object({
      urls: z.array(
        z.object({
          url: z
            .string()
            .describe(
              "The most relevant URL that can be used to get the content"
            ),
        })
      ),
    }),
  });
  return urlRes.urls;
}

async function summarizeContent(
  content: string,
  title: string,
  url: string,
  research: ResearchPlan,
  spinner: Spinner
): Promise<string> {
  // Split content into chunks of roughly 10000 characters
  const chunkSize = 10000;
  const chunks = content.match(new RegExp(`.{1,${chunkSize}}`, "g")) || [];

  // First level summarization - summarize each chunk
  spinner.text = `${research.title}\n   Summarizing content from ${url}...`;
  const chunkSummaries = await Promise.all(
    chunks.map(async (chunk, index) => {
      const { text } = await generateText({
        model: fastModel,
        prompt: `Summarize the following content from "${title}" (part ${
          index + 1
        }/${chunks.length}). Focus on key points related to: ${
          research.objectives
        }\n\nContent:\n${chunk}`,
      });
      return text;
    })
  );

  // If we have multiple chunks, do a second level summarization
  if (chunkSummaries.length > 1) {
    spinner.text = `${research.title}\n   Combining summaries from ${url}...`;
    const { text: finalSummary } = await generateText({
      model: fastModel,
      prompt: `Combine these summaries from "${title}" into a coherent summary. Focus on key points related to: ${
        research.objectives
      }\n\nSummaries:\n${chunkSummaries.join("\n\n")}`,
    });
    return finalSummary;
  }

  return chunkSummaries[0];
}

async function processWebResearch(
  research: ResearchPlan,
  spinner: Spinner
): Promise<ResearchSummary> {
  // Search results with pagination
  spinner.text = `${research.title}\n   Searching: ${research.query}`;
  const MAX_PAGES = 5;
  let allResults: SearchResult[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    spinner.text = `${research.title}\n   Searching: ${research.query} (Page ${page}/${MAX_PAGES})`;
    const searchRes = await fetch(
      `https://search.maia.id/search?q=${research.query}&format=json&safesearch=0&pageno=${page}`
    );
    const searchData = await searchRes.json();

    // If no results, break the loop
    if (!searchData.results || searchData.results.length === 0) {
      break;
    }

    const pageResults = searchData.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      content: result.content,
    }));
    allResults = [...allResults, ...pageResults];
  }

  // Get relevant URLs and fetch content
  const relevantUrls = await getRelevantUrls(allResults, research, spinner);
  const contents = await Promise.all(
    relevantUrls.map(({ url }) => fetchWebContent(url, spinner, research.title))
  );
  const validContents = contents.filter(
    (content): content is WebContent => content !== null
  );

  // Process each content and get summaries
  const contentSummaries = await Promise.all(
    validContents.map((content) =>
      summarizeContent(
        content.content,
        content.title,
        content.url,
        research,
        spinner
      )
    )
  );

  // Final summarization combining all content summaries
  spinner.text = `${research.title}\n   Generating final answer...`;
  const { text: answer } = await generateText({
    model: fastModel,
    prompt: `You're conducting a research on ${
      research.title
    }. Your objective is ${
      research.objectives
    }. Here is the expected outcomes: ${
      research.expectedOutcomes
    }. Based on the following summaries from different sources, provide a comprehensive answer:\n\n${contentSummaries.join(
      "\n\n"
    )}`,
  });

  spinner.succeed(`${research.title}`);
  return {
    answer,
    references: validContents.map((content) => ({
      url: content.url,
      title: content.title,
    })),
  };
}

async function processAiResearch(
  research: ResearchPlan,
  spinner: Spinner
): Promise<ResearchSummary> {
  spinner.text = `${research.title}\n   Processing...`;
  const { text: answer } = await generateText({
    model: fastModel,
    prompt: research.query,
  });
  spinner.succeed(`${research.title}`);
  return { answer, references: [] };
}

async function deepResearch(prompt: string): Promise<string> {
  const mainSpinner = new Spinner().start("Generating research plan...");

  const { object: plan } = await generateObject({
    model: flagshipModel,
    prompt,
    system: systemPrompt,
    schema: researchPlanSchema,
  });

  mainSpinner.succeed(`Research Plan Generated!`);
  console.log("===");
  console.log(`Title: ${plan.title}`);
  console.log(`Expected Outcomes: ${plan.expectedOutcomes}`);
  console.log("===");
  console.log("Research Plan:");

  // Create spinners for each research plan
  const spinners = plan.researchPlan.map((research, index) => {
    return new Spinner().start(
      `${index + 1}. ${research.title}\n   Objective: ${research.objectives}`
    );
  });

  // Process research plans
  const summaries = await Promise.all(
    plan.researchPlan.map((research, index) => {
      const spinner = spinners[index];
      return research.type === "web"
        ? processWebResearch(research, spinner)
        : processAiResearch(research, spinner);
    })
  );

  console.log("===");
  // Generate final report
  const finalSpinner = new Spinner().start("Generating final report...");
  const { text: report } = await generateText({
    model: flagshipModel,
    prompt: `You're conducting a research, the title is ${plan.title}.
Your objective is: ${plan.objectives}.
Here is the expected outcomes: ${plan.expectedOutcomes}.

Here is the current research plan:
${plan.researchPlan
  .map((e, i) => `${i + 1}. ${e.title}: ${e.query}`)
  .join("\n")}

Here is the result based on the research plan above:
${summaries
  .map(
    (e, i) =>
      `${i + 1}. ${e.answer}${
        e.references
          ? `\nReferences:${e.references
              .map((ref) => `- (${ref.url})[${ref.title}]`)
              .join("\n")}`
          : ""
      }`
  )
  .join("\n")}

Requirements:
- Write in clear, professional article format using markdown
- Each paragraph/claim must include reference URLs in brackets at the end
- ALWAYS USE MULTIPLE REFERENCES WHERE POSSIBLE, SEPARATED BY SEMICOLONS (e.g., [full_url1; full_url2; full_url3])
- The references should be the full URL, not just the domain name.
- Exclude any objectives, research plans or expected outcomes sections
- Focus purely on presenting the research findings in a cohesive narrative
- The language of the report is ${plan.language}`,
  });

  finalSpinner.succeed("Research completed!");
  return report;
}

if (import.meta.main) {
  await new Command()
    .name("deep-research")
    .description("CLI tool for conducting deep research (PoC)")
    .arguments("<prompt:string>")
    .action(async (_: unknown, prompt: string) => {
      if (!prompt) {
        console.error("Prompt is required");
        Deno.exit(1);
      }

      const startTime = performance.now();
      const report = await deepResearch(prompt);
      const endTime = performance.now();
      const executionTime = ((endTime - startTime) / 1000).toFixed(2);

      await Deno.writeTextFile("report.md", report);
      console.log(`\nResearch completed in ${executionTime} seconds`);
      console.log("Report has been saved to report.md");
    })
    .parse(Deno.args);
}
