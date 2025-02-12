const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://www.google.co.uk/maps/search/liquor+store/@33.511987,-112.1552963,10z?entry=ttu&g_ep=EgoyMDI1MDIwOS4wIKXMDSoASAFQAw%3D%3D');

    // Handle cookie consent dialog
    try {
        await page.click('button[aria-label="Reject all"]'); // Adjust the selector as needed
    } catch (error) {
        console.log('No cookie consent dialog found');
    }

    const targetText = "You've reached the end of the list."; // Corrected typo

    // Wait for the element to be present
    await page.waitForSelector('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', { timeout: 10000 });

    await page.evaluate(async (targetText) => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (element) {
            console.log('Element found, starting to scroll...');
            while (!element.innerText.includes(targetText)) {
                element.scrollBy(0, 1000); // Adjust the scroll amount as needed
                console.log('Scrolling...'); // Log when it scrolls
                await new Promise(resolve => setTimeout(resolve, 500)); // Adjust the delay as needed
            }
            console.log('Reached the end of the list.');
        } else {
            console.error('Element not found');
        }
    }, targetText);

    // Wait for content to load
    await page.waitForTimeout(400);

    // Extract and log the number of URLs found on the page
    const urls = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a');
        return Array.from(anchors).map(anchor => anchor.href);
    });

    console.log('Number of URLs found:', urls.length);
    console.log('URLs:', urls);

    await browser.close();
})();