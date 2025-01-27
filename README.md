# Adaptive Web Scraping Tool

A sophisticated web scraping tool designed to extract contact information and company details from websites using Playwright and LLM-powered analysis.

## Features

- 🌐 Headless browser automation with Playwright
- 🛡️ Anti-detection measures using playwright-stealth
- 📊 Structured data extraction for:
  - Contact information (email, phone, address)
  - Social media links
  - Company information
- 🤖 LLM-powered content analysis using Ollama
- 📝 HTML content storage

## Prerequisites

- Python 3.8+
- Ollama installed and running locally

## Installation

1. Clone the repository: 

2. Create and activate a virtual environment

3. Install required packages:

4. Install Playwright browsers:


When prompted, enter the URL you want to scrape. The script will:
1. Scrape the webpage using Playwright
2. Extract contact information and social media links
3. Save the raw HTML content
4. Generate a structured JSON response with the extracted information

## Configuration

The `WebScraper` class accepts the following parameters:
- `headless`: Boolean to control browser visibility (default: True)
- `browser_type`: Browser to use ("chromium", "firefox", or "webkit")
- `chunk_size`: Size of text chunks for processing
- `max_tokens`: Maximum tokens for LLM processing

## Disclaimer

Please ensure you have permission to scrape any website and comply with their robots.txt file and terms of service.