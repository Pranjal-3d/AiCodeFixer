const mongoose = require("mongoose");

const HistorySchema = new mongoose.Schema({
  owner: { type: String, required: true },
  repo: { type: String, required: true },
  branch: { type: String, required: true },
  path: { type: String, required: true },
  summary: { type: String },
  issues_found: { type: [String], default: [] },
  has_fix: { type: Boolean, default: false },
  analyzed_at: { type: Date, default: Date.now }
});

const HistoryModel = mongoose.model("History", HistorySchema);

async function initCollection() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.warn("⚠️  MONGO_URI not found in env, unable to connect to database!");
      return;
    }
    
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log("✅ MongoDB connected successfully!");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}

async function saveAnalysis({ owner, repo, branch, results }) {
  const entries = results.map(r => ({
    owner, repo, branch,
    path: r.path,
    summary: r.summary,
    issues_found: r.issues_found,
    has_fix: r.has_fix,
    analyzed_at: new Date()
  }));

  try {
    await HistoryModel.insertMany(entries);
    console.log(`✅ Saved ${entries.length} records to MongoDB`);
  } catch (err) {
    console.error("❌ Failed to save analysis to MongoDB:", err.message);
  }
}

async function searchHistory(query, limit = 10) {
  const q = new RegExp(query, "i");
  try {
    return await HistoryModel.find({
      $or: [
        { summary: q },
        { path: q },
        { issues_found: q },
        { owner: q },
        { repo: q }
      ]
    }).sort({ analyzed_at: -1 }).limit(limit).lean();
  } catch (err) {
    console.error("❌ Error searching history:", err.message);
    return [];
  }
}

async function getRepoHistory(owner, repo, limit = 20) {
  try {
    return await HistoryModel.find({
      owner: new RegExp(`^${owner}$`, "i"),
      repo: new RegExp(`^${repo}$`, "i")
    }).sort({ analyzed_at: -1 }).limit(limit).lean();
  } catch (err) {
    console.error("❌ Error getting repo history:", err.message);
    return [];
  }
}

async function getAvailableRepos() {
  try {
    const pipeline = [
      {
        $group: {
          _id: {
            owner: { $toLower: "$owner" },
            repo: { $toLower: "$repo" }
          },
          originalOwner: { $first: "$owner" },
          originalRepo: { $first: "$repo" },
          latest_at: { $max: "$analyzed_at" }
        }
      },
      { $sort: { latest_at: -1 } }
    ];

    const results = await HistoryModel.aggregate(pipeline);
    
    return results.map(r => ({
      owner: r.originalOwner,
      repo: r.originalRepo,
      full_name: `${r.originalOwner}/${r.originalRepo}`,
      latest_at: r.latest_at
    }));
  } catch (err) {
    console.error("❌ Error getting available repos:", err.message);
    return [];
  }
}

module.exports = { initCollection, saveAnalysis, searchHistory, getRepoHistory, getAvailableRepos, HistoryModel };