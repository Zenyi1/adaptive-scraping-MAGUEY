const fs = require('fs');

// Load the leads data from a JSON file
function loadLeads(filePath) {
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
}

// Rank leads based on a simple heuristic
function rankLeads(leads) {
    return leads.sort((a, b) => {
        // Example heuristic: prioritize higher ratings and more reviews
        if (b.rating === a.rating) {
            return b.reviewCount - a.reviewCount;
        }
        return b.rating - a.rating;
    });
}

// Save the ranked leads to a new JSON file
function saveRankedLeads(rankedLeads, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(rankedLeads, null, 2));
    console.log(`Ranked leads saved to ${outputPath}`);
}

// Main function to load, rank, and save leads
function main() {
    const inputFilePath = 'output2.json'; // Input file with scraped leads
    const outputFilePath = 'ranked_leads.json'; // Output file for ranked leads

    const leads = loadLeads(inputFilePath);
    const rankedLeads = rankLeads(leads);
    saveRankedLeads(rankedLeads, outputFilePath);
}

main(); 