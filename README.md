# Deep Research CLI

A tool for conducting comprehensive research by combining web searches and AI-powered analysis. This tool automates the research process by gathering information from multiple sources and providing well-structured, analyzed results.

## Prerequisites

- Deno runtime
- OpenAI API key

## Installation

1. Clone this repository
2. Copy `.env.example` to `.env` and fill in your OpenAI API key
3. Install dependencies using Deno

## Environment Variables

Create a `.env` file with the following:

```env
OPENAI_API_KEY=your_api_key_here
```

## Usage

Run the deep research tool using Deno:

```bash
deno run -A main.ts "your research query"
```

## How It Works

The research process is divided into three main phases:

1. **Research Phase**
   - Automatically generates comprehensive information about the topic
   - Gathers data through web searches (top 10 websites)
   - Utilizes AI language models for additional insights
   - Summarizes findings concisely

2. **Analysis Phase**
   - Analyzes summarized information from the research phase
   - Tailors analysis to address specific user questions
   - Distills information into key points

3. **Reporting Phase**
   - Integrates analysis results into a cohesive article
   - Provides a well-rounded overview of the topic
   - Includes references to source materials
