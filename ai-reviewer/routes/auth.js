const express = require("express");
const axios = require("axios");

const router = express.Router();

router.get("/github/login", (req, res) => {

  const redirectUrl =
    "https://github.com/login/oauth/authorize" +
    "?client_id=" +
    process.env.GITHUB_CLIENT_ID +
    "&scope=repo";

  res.redirect(redirectUrl);

});

router.get("/github/callback", async (req, res) => {

  const code = req.query.code;

  try {

    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code
      },
      {
        headers: { Accept: "application/json" }
      }
    );

    const accessToken = response.data.access_token;

    res.json({
      message: "GitHub login successful",
      access_token: accessToken
    });

  } catch (error) {

    res.status(500).json({
      error: "GitHub authentication failed"
    });

  }

});

module.exports = router;