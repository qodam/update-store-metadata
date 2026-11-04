const jwt = require("jsonwebtoken");
const axios = require("axios");
const fs = require("fs");
const { ISSUER_ID, KEY_ID, PRIVATE_KEY_PATH } = require("../../config/config");

const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH);

const api = axios.create({
  baseURL: "https://api.appstoreconnect.apple.com/v1",
});

// Un token neuf à chaque requête : pas de souci d'expiration
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${jwt.sign({}, PRIVATE_KEY, {
    algorithm: "ES256",
    expiresIn: "19m",
    issuer: ISSUER_ID,
    audience: "appstoreconnect-v1",
    keyid: KEY_ID,
  })}`;
  return config;
});

module.exports = api;
