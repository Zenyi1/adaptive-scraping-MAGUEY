const { chromium } = require('playwright');

async function searchWebsite(url, searchTerm) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const content = await page.content();

        // Simple search for the term in the page content
        const found = content.includes(searchTerm);
        console.log(`Search term "${searchTerm}" ${found ? 'found' : 'not found'} on ${url}`);
    } catch (error) {
        console.error(`Error searching ${url}:`, error.message);
    } finally {
        await browser.close();
    }
}

// Example usage
const websiteUrl = 'https://www.example.com';
const termToSearch = 'contact';
searchWebsite(websiteUrl, termToSearch); 