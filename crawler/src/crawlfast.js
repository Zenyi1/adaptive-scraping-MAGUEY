const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer').createObjectCsvWriter;

const batchSize = 5;

async function launchBrowser() {
    return await chromium.launch({ headless: false });
}

async function handleCookieConsent(page) {
    try {
        await page.click('button[aria-label="Reject all"]'); // Adjust the selector as needed
    } catch (error) {
        console.log('No cookie consent dialog found');
    }
}

async function scrollToEnd(page, targetText) {
    await page.waitForSelector('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', { timeout: 10000 });

    await page.evaluate(async (targetText) => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (element) {
            console.log('Element found, starting to scroll...');
            while (!element.innerText.includes(targetText)) {
                element.scrollBy(0, 400); // Adjust the scroll amount as needed
                console.log('Scrolling...'); // Log when it scrolls
                await new Promise(resolve => setTimeout(resolve, 500)); // Adjust the delay as needed
            }
            console.log('Reached the end of the list.');
        } else {
            console.error('Element not found');
        }
    }, targetText);

    await page.waitForTimeout(400);
}

async function extractUrls(page) {
    return await page.evaluate(() => {
        const anchors = document.querySelectorAll('a');
        return Array.from(anchors).map(anchor => anchor.href);
    });
}

async function scrapeDetails(page, url) {
    await page.goto(url);

    const address = await page.evaluate(() => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[9]/div[3]/button/div/div[2]/div[1]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return element ? element.innerText : 'Address not found';
    });

    const title = await page.evaluate(() => {
        const element = document.evaluate('//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[2]/div/div[1]/div[1]/h1', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        return element ? element.innerText : 'Title not found';
    });

    const websiteElements = await page.$$('a[data-tooltip="Open website"]') || await page.$$('a[data-tooltip="Open menu link"]');
    let website = '';
    if (websiteElements.length > 0) {
        website = await page.evaluate(element => element.getAttribute('href'), websiteElements[0]);
    }

    const phoneElements = await page.$$('button[data-tooltip="Copy phone number"]');
    let phone = '';
    if (phoneElements.length > 0) {
        phone = await page.evaluate(element => element.textContent, phoneElements[0]);
    }

    return { title, address, website, phone };
}

async function writeCsv(records) {
    const writer = csvWriter({
        path: path.join(__dirname, 'output.csv'),
        header: [
            { id: 'title', title: 'Title' },
            { id: 'address', title: 'Address' },
            { id: 'website', title: 'Website' },
            { id: 'phone', title: 'Phone' }
        ]
    });

    await writer.writeRecords(records);
    console.log('Data saved to output.csv');
}

async function processABatch(batch, page) {
    const records = [];
    for (const url of batch) {
        const details = await scrapeDetails(page, url);
        console.log(`URL: ${url}`);
        console.log(`Address: ${details.address}`);
        console.log(`Title: ${details.title}`);
        console.log(`Website: ${details.website}`);
        console.log(`Phone: ${details.phone}`);
        records.push(details);
    }
    await writeCsv(records);
    console.log(`Batch processed.`);
}

(async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto('https://www.google.com/maps/search/liquor+store/@57.1495773,-2.1197757,12z/data=!3m1!4b1?entry=ttu&g_ep=EgoyMDI1MDIxOC4wIKXMDSoASAFQAw%3D%3D');

    await handleCookieConsent(page);

    const targetText = "You've reached the end of the list.";
    await scrollToEnd(page, targetText);

    const urls = await extractUrls(page);
    console.log('Number of URLs found:', urls.length);
    console.log('URLs:', urls);

    const numOfBatches = Math.ceil(urls.length / batchSize);

    for (let batchIndex = 0; batchIndex < numOfBatches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, urls.length);

        const batch = urls.slice(start, end);

        await processABatch(batch, page);

        console.log(`Batch ${batchIndex + 1} processed.`);
        console.log("");
    }

    await browser.close();
})();