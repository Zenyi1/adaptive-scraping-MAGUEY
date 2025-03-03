const { chromium } = require('playwright');

async function extractEmails() {
  // Launch a browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to the specified URL
    console.log('Navigating to https://www.magueyexchange.com...');
    await page.goto('https://www.magueyexchange.com', { waitUntil: 'domcontentloaded' });
    
    // Wait for the page to load completely
    await page.waitForLoadState('networkidle');
    
    // Extract all the text content from the page
    const content = await page.content();
    
    // Regular expression to match email addresses
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    
    // Find all email addresses in the content
    const emails = content.match(emailRegex);
    
    if (emails && emails.length > 0) {
      console.log('Emails found on the page:');
      // Remove duplicates using Set
      const uniqueEmails = [...new Set(emails)];
      uniqueEmails.forEach(email => console.log(`- ${email}`));
    } else {
      console.log('No email addresses found on the page.');
    }
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

// Run the function
extractEmails();