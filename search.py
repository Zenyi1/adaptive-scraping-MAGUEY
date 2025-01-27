# Import necessary libraries
import json
import ollama
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync
from bs4 import BeautifulSoup
import traceback

# Define the URL to scrape
url = input("Enter the URL to scrape: ")  # This will prompt the user for a URL
# Or you can hardcode it:
# url = "https://example.com"

# Web Scraper class definition
class WebScraper:
    def __init__(self, headless=True, browser_type="chromium", chunk_size=256, max_tokens=1000):
        self.headless = headless
        self.browser_type = browser_type
        self.chunk_size = chunk_size
        self.max_tokens = max_tokens

    def scrape_page(self, url: str) -> str:
        with sync_playwright() as p:
            browser = getattr(p, self.browser_type).launch(
                headless=self.headless,
                args=["--disable-gpu", "--no-sandbox"]
            )
            context = browser.new_context()
            page = context.new_page()

            stealth_sync(page)
            page.goto(url)

            html_content = page.content()
            browser.close()
        return html_content

    def extract_contact_info(self, html_content: str) -> dict:
        soup = BeautifulSoup(html_content, 'html.parser')
        contact_info = {
            'social_media': {},
            'links': [],
            'email': None,
            'phone': None
        }

        # Find social media links in footer
        social_links = soup.find_all('a', class_='link-foot-social')
        for link in social_links:
            href = link.get('href', '')
            if 'instagram' in href:
                contact_info['social_media']['instagram'] = href
            elif 'linkedin' in href:
                contact_info['social_media']['linkedin'] = href
            elif 'facebook' in href:
                contact_info['social_media']['facebook'] = href

        # Extract phone numbers (look for tel: links and common phone patterns)
        phone_links = soup.find_all('a', href=lambda x: x and 'tel:' in x)
        for link in phone_links:
            contact_info['phone'] = link['href'].replace('tel:', '')
        
        # Extract emails (look for mailto: links)
        email_links = soup.find_all('a', href=lambda x: x and 'mailto:' in x)
        for link in email_links:
            contact_info['email'] = link['href'].replace('mailto:', '')
        
        # Extract text content for company info
        main_content = soup.find('main') or soup.find('article') or soup.find('div', class_=['content', 'main'])
        if main_content:
            contact_info['company_info'] = main_content.get_text(separator=' ', strip=True)
        
        return contact_info

    def query_page_content(self, url: str) -> dict:
        raw_html = self.scrape_page(url)
        structured_data = {
            "url": url,
            "raw_html": raw_html,
            "contact_info": self.extract_contact_info(raw_html)
        }
        return structured_data


# Function to scrape and extract data
def query_web_scraper(url: str) -> dict:
    scraper = WebScraper(headless=False)
    return scraper.query_page_content(url)

# Function to write raw HTML to file
def write_raw_html_to_file(raw_html: str, filename: str = "scraped_content.html"):
    with open(filename, "w", encoding="utf-8") as f:
        f.write(raw_html)
    print(f"Raw HTML content has been written to {filename}")


# Initialize model and messages
model = 'llama3.1'

# Revised system message to be more focused on contact information
system_message = {
    'role': 'system',
    'content': '''You are a specialized data extractor focused on finding business contact information and company details. 
    When analyzing web content, identify and extract:
    1. Contact Information:
        - Phone numbers
        - Email addresses
        - Physical addresses
        - Contact form URLs
        - Business hours
        - Contact person names and titles
    2. Social Media Presence:
        - LinkedIn
        - Facebook
        - Twitter/X
        - Instagram
        - Other social platforms
    3. Company Overview:
        - Main products/services
        - Brief company description
        - Key features or specialties
    
    Format all information in a clean, structured JSON format.'''
}

# More specific user message
user_message = {
    'role': 'user',
    'content': f'Please analyze the webpage at {url} and extract all contact information and company details as specified. Focus on finding any possible way to contact the business.'
}

# Initialize conversation with the system message and user query
messages = [system_message, user_message]

# First API call: Send the query and function description to the model
response = ollama.chat(
    model=model,
    messages=messages,
    tools=[
        {
            'type': 'function',
            'function': {
                'name': 'query_web_scraper',
                'description': 'Scrapes the content of a web page and returns the structured JSON object with titles, articles, and associated links.',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'url': {
                            'type': 'string',
                            'description': 'The URL of the web page to scrape.',
                        },
                    },
                    'required': ['url'],
                },
            },
        },
    ]
)

# Append the model's response to the existing messages
messages.append({
    'role': 'assistant',
    'content': response['message']['content'],
    'tool_calls': response['message'].get('tool_calls', [])
})

# Check if the model decided to use the provided function
if not response['message'].get('tool_calls'):
    print("The model didn't use the function. Its response was:")
    print(response['message']['content'])
else:
    # Process function calls made by the model
    scraped_data = None
    available_functions = {'query_web_scraper': query_web_scraper}

    for tool in response['message']['tool_calls']:
        function_name = tool['function']['name']
        function_to_call = available_functions[function_name]
        function_args = tool['function']['arguments']
        scraped_data = function_to_call(function_args['url'])  # Use await for async function call
        
        print(f"Function '{function_name}' was called with the URL: {function_args['url']}")
        
        # Write raw HTML to file
        write_raw_html_to_file(scraped_data['raw_html'])
        
        # Add function response to the conversation
        messages.append({
            'role': 'tool',
            'name': function_name,
            'content': json.dumps(scraped_data),
        })

    if scraped_data:
        # Additional instruction to ensure proper use of scraped data
        additional_instruction = {
            'role': 'user',
            'content': f"""Here's the scraped data from the website:
            
            {json.dumps(scraped_data, indent=2)}
            
            Using this scraped data, create a structured JSON response that includes only the most relevant and important information from the website.
            Ignore head section. Focus on the main body section. Do not include HTML tags or unnecessary details.
            Ensure your response is in valid JSON format without any additional text or comments."""
        }
        messages.append(additional_instruction)

        # Final API call: Get structured JSON response from the model
        final_response = ollama.chat(model=model, messages=messages)
        print(final_response['message']['content'])
    else:
        print("No data was scraped. Unable to proceed with creating a structured JSON response.")