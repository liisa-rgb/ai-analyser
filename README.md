# Stay Relevant in an AI World — Analysis Tool

Upload between 1 and 14 daily reflection documents, add optional aspirations,
and receive a personalised AI analysis of your reflection period.

## Deploy to Vercel

1. Create a new GitHub repository and upload all files in this folder
2. Connect the repository to Vercel at https://vercel.com
3. Add environment variable: `ANTHROPIC_API_KEY` = your key (NOT `VITE_ANTHROPIC_API_KEY`)
4. Deploy

## How it works

- Participants upload the .doc files they downloaded each day from the Daily Reflection Tracker
- The tool reads and extracts their answers automatically
- They can optionally add their opening and closing aspirations
- The analysis runs via a server-side proxy (`/api/claude`) to keep the API key secure
- They receive a structured report with actionable AI project ideas
