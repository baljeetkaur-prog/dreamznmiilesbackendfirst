const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt"); // for secure password hashing
require("dotenv").config();

const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

// ===== Cloudinary Config =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "destinations",
    allowed_formats: ["jpg", "jpeg", "png", "webp"]
  }
});
const upload = multer({ storage });

// ===== Express App =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== MongoDB Connection =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB Connected"))
.catch(err => console.error("DB Connection Error:", err));

// ===== Admin Schema =====
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const Admin = mongoose.model("Admin", adminSchema);

// Create default admin
(async () => {
  try {
    const existingAdmin = await Admin.findOne({ username: process.env.ADMIN_USERNAME });
    if (!existingAdmin) {
      await Admin.create({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD
      });
      console.log("Default admin created");
    }
  } catch (err) {
    console.error("Error creating default admin:", err);
  }
})();

// ===== Admin Login =====
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin || admin.password !== password) {
      return res.status(400).json({ error: "Invalid username or password" });
    }
    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ message: "Login successful", token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/admin/change-password", async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Get the logged-in admin from token (assume you have auth middleware)
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    // Check old password
    if (admin.password !== oldPassword) {
      return res.status(400).json({ error: "Old password is incorrect" });
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Destination Schema =====
const destinationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  images: [String],
  thumbnail: String,
  price: Number,
  days: String,
  shortDescription: String,
  highlights: [String],
  inclusions: [String],
  exclusions: [String],
  itinerary: [
    { day: String, title: String, description: String }
  ],
  hotels: [
    { city: String, name: String, rating: String, nights: Number }
  ],
  availableDates: [String],
  transportation: [String],
  pricing: {
    adult: Number,
    child: Number,
    singleSupplement: Number
  },
  policies: {
    cancellation: [String],
    payment: [String]
  },
  termsConditions: [String],
  location: {
    country: String,
    city: String,
    coordinates: { lat: Number, lng: Number }
  },
  activities: [
    { name: String, description: String, duration: String, location: String, included: [String], images: [String] }
  ]
}, { timestamps: true });

const Destination = mongoose.model("Destination", destinationSchema);

// ===== Destination Routes =====

// Get all packages
app.get("/api/admin/packages", async (req, res) => {
  try {
    const packages = await Destination.find();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get package by ID
app.get("/api/admin/packages/:id", async (req, res) => {
  try {
    const pkg = await Destination.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add new package
app.post(
  "/api/admin/packages",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "activityImages", maxCount: 50 },
  ]),
  async (req, res) => {
    try {
      const data = { ...req.body };

      // Parse JSON fields safely
      const jsonFields = [
        "itinerary",
        "hotels",
        "activities",
        "pricing",
        "policies",
        "location",
        "termsConditions",
        "highlights",
        "inclusions",
        "exclusions",
        "availableDates",
        "transportation",
      ];

      jsonFields.forEach((field) => {
        if (data[field] && typeof data[field] === "string") {
          try {
            data[field] = JSON.parse(data[field]);
          } catch (err) {
            console.warn(`Failed to parse field ${field}:`, err.message);
            data[field] = Array.isArray(data[field]) ? data[field] : [];
          }
        }
      });

      // Generate a unique ID
      data.id = uuidv4();

      // Handle thumbnail
      if (req.files.thumbnail?.length) {
        data.thumbnail = req.files.thumbnail[0].path;
      }

      // Handle package images
      if (req.files.images?.length) {
        data.images = req.files.images.map((f) => f.path);
      }

      // Handle activity images
      if (data.activities && req.files.activityImages?.length) {
        let imgIdx = 0;
        data.activities.forEach((act) => {
          const count = act.imageCount || 1; // optional: can be sent from frontend
          act.images = req.files.activityImages
            .slice(imgIdx, imgIdx + count)
            .map((f) => f.path);
          imgIdx += count;
        });
      }

      // Save to MongoDB
      const newPackage = new Destination(data);
      await newPackage.save();

      res.json({ success: true, message: "Package added successfully", package: newPackage });
    } catch (err) {
      console.error("Error saving package:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);
app.put(
  "/api/admin/packages/:id",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "images", maxCount: 10 },
    { name: "activityImages", maxCount: 50 },
  ]),
  async (req, res) => {
    try {
      const existingPackage = await Destination.findById(req.params.id);
      if (!existingPackage)
        return res.status(404).json({ message: "Package not found" });

      const data = {};

      // Parse fields
      for (const key in req.body) {
        try {
          data[key] = JSON.parse(req.body[key]);
        } catch {
          data[key] = req.body[key];
        }
      }

      // Update thumbnail if new file uploaded
      if (req.files.thumbnail?.length) {
        data.thumbnail = req.files.thumbnail[0].path;
      } else {
        data.thumbnail = existingPackage.thumbnail;
      }

      // Merge images
      if (req.files.images?.length) {
        data.images = [...(existingPackage.images || []), ...req.files.images.map(f => f.path)];
      } else {
        data.images = existingPackage.images;
      }

      // Merge activity images
      if (Array.isArray(existingPackage.activities)) {
        data.activities = existingPackage.activities.map((act, idx) => {
          const existingImgs = act.images || [];
          let newImgs = [];

          if (data.activities?.[idx]?.images) {
            newImgs = data.activities[idx].images;
          }

          // Append new uploaded activity files
          const uploadedFiles = req.files.activityImages || [];
          const count = uploadedFiles.splice(0, newImgs.length).map(f => f.path);

          return {
            ...act,
            ...data.activities?.[idx],
            images: [...existingImgs, ...count]
          };
        });
      }

      const updatedPackage = await Destination.findByIdAndUpdate(
        req.params.id,
        data,
        { new: true }
      );

      res.json({ success: true, message: "Package updated successfully", package: updatedPackage });
    } catch (err) {
      console.error("Update Error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);














app.delete("/api/admin/packages/:id", async (req, res) => {
  try {
    const pkg = await Destination.findById(req.params.id);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    // Collect all Cloudinary public IDs to delete
    const publicIds = [];

    // Thumbnail
    if (pkg.thumbnail) {
      publicIds.push(getPublicId(pkg.thumbnail));
    }

    // Main images
    if (Array.isArray(pkg.images)) {
      pkg.images.forEach(url => publicIds.push(getPublicId(url)));
    }

    // Activity images
    if (Array.isArray(pkg.activities)) {
      pkg.activities.forEach(act => {
        if (Array.isArray(act.images)) {
          act.images.forEach(url => publicIds.push(getPublicId(url)));
        }
      });
    }

    // Delete images from Cloudinary
    await Promise.all(publicIds.filter(Boolean).map(id => cloudinary.uploader.destroy(id)));


    // Delete from MongoDB
    await Destination.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: "Package and images deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Helper: extract Cloudinary public ID from URL
function getPublicId(url) {
  try {
    // Remove query string
    const cleanUrl = url.split("?")[0];

    // Match folder/filename without extension, ignoring version
    const match = cleanUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    if (!match) return null;

    return match[1]; // returns: destinations/tofahzbdxqjbtieyrkxd
  } catch (err) {
    console.error("Error extracting public_id from:", url, err);
    return null;
  }
}
app.get("/api/packagesearch", async (req, res) => {
  try {
    const { title, minPrice, maxPrice, days } = req.query;

    if (!title) return res.json([]); // no title, no results

    // Primary filter: title
    let filter = { title: { $regex: title, $options: "i" } };

    // Secondary filters
    if (minPrice && maxPrice) {
      filter.price = { $gte: Number(minPrice), $lte: Number(maxPrice) };
    }
    if (days) {
      filter.days = days; // exact match
    }

    let results = await Destination.find(filter);

    // If nothing found with full filters, fallback to title-only results
    if (results.length === 0) {
      results = await Destination.find({
        title: { $regex: title, $options: "i" },
      });
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});





app.get("/api/packageprices", async (req, res) => {
  try {
    const prices = await Destination.distinct("price"); // now numbers
    res.json(prices.sort((a, b) => a - b));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

const hotelSchema = new mongoose.Schema({
  title: { type: String, required: true },
  images: [String],        // Array of Cloudinary URLs
  price: String,
  perPerson: String,
  location: String,
  reviews: Number,
  overview: String,
  popularAmenities: [String],
  highlights: [String],
  type: String,
  roomType: String,
}, { timestamps: true });

const Hotel = mongoose.model("Hotel", hotelSchema);
app.get("/api/admin/hotels", async (req, res) => {
  try {
    const hotels = await Hotel.find();
    res.json(hotels);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get hotel by ID
app.get("/api/admin/hotels/:id", async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });
    res.json(hotel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add new hotel
app.post(
  "/api/admin/hotels",
  upload.array("images", 10), // multiple hotel images
  async (req, res) => {
    try {
      const data = { ...req.body };

      // Parse array fields safely if sent as JSON strings
      ["popularAmenities", "highlights"].forEach((field) => {
        if (data[field] && typeof data[field] === "string") {
          try {
            data[field] = JSON.parse(data[field]);
          } catch {
            data[field] = data[field].split(",").map((i) => i.trim());
          }
        }
      });

      // Handle images uploaded via Cloudinary
      if (req.files?.length) {
        data.images = req.files.map((f) => f.path);
      }

      const newHotel = new Hotel(data);
      await newHotel.save();
      res.json({ success: true, message: "Hotel added", hotel: newHotel });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Update hotel
app.put(
  "/api/admin/hotels/:id",
  upload.array("images", 10),
  async (req, res) => {
    try {
      const data = {};

      // Only copy non-empty values
      for (const [key, value] of Object.entries(req.body)) {
        if (value === "" || value === "null" || value === null || value === undefined) {
          continue; // skip empty
        }
        data[key] = value;
      }

      // Parse array fields
      ["popularAmenities", "highlights"].forEach((field) => {
        if (data[field] && typeof data[field] === "string") {
          try {
            data[field] = JSON.parse(data[field]);
          } catch {
            data[field] = data[field].split(",").map((i) => i.trim());
          }
        }
      });

      // Parse existingImages JSON string
      const oldImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];

      // New uploaded images
      const newImages = req.files ? req.files.map((f) => f.path) : [];

      // Merge
      data.images = [...oldImages, ...newImages];

      // Update only given fields
      const updatedHotel = await Hotel.findByIdAndUpdate(
        req.params.id,
        { $set: data },
        { new: true }
      );

      if (!updatedHotel) {
        return res.status(404).json({ message: "Hotel not found" });
      }

      res.json({ success: true, message: "Hotel updated", hotel: updatedHotel });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  }
);



// Delete hotel
app.delete("/api/admin/hotels/:id", async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) return res.status(404).json({ message: "Hotel not found" });

    // Collect all Cloudinary public IDs
    const publicIds = [];

    // Hotel images
    if (Array.isArray(hotel.images)) {
      hotel.images.forEach(url => {
        const publicId = getPublicId(url);
        if (publicId) publicIds.push(publicId);
      });
    }

    // Delete images from Cloudinary
    await Promise.all(publicIds.map(id => cloudinary.uploader.destroy(id)));

    // Delete hotel from MongoDB
    await Hotel.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: "Hotel and images deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Helper: extract Cloudinary public ID from URL
function getPublicId(url) {
  try {
    // Remove query string
    const cleanUrl = url.split("?")[0];

    // Match folder/filename without extension, ignoring version
    const match = cleanUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    if (!match) return null;

    return match[1]; // e.g., hotels/abc123xyz
  } catch (err) {
    console.error("Error extracting public_id from:", url, err);
    return null;
  }
}
// Visa Schema
const visaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    image: { type: String },           // Cloudinary URL
    visaType: { type: String },
    validity: { type: String },
    processingTime: { type: String },
    visaMode: { type: String },
    country: { type: String },
    overview: { type: String },
    requiredDocuments: [{ type: String }],
  },
  { timestamps: true }
);

const Visa = mongoose.model("Visa", visaSchema, "visa");

// Helper: extract Cloudinary public ID from URL
function getPublicId(url) {
  try {
    const cleanUrl = url.split("?")[0];
    const match = cleanUrl.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    return match ? match[1] : null;
  } catch (err) {
    console.error("Error extracting public_id from:", url, err);
    return null;
  }
}

// GET all visas
app.get("/api/admin/visas", async (req, res) => {
  try {
    const visas = await Visa.find();
    res.json({ success: true, visas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET visa by ID
app.get("/api/admin/visas/:id", async (req, res) => {
  try {
    const v = await Visa.findById(req.params.id);
    if (!v) return res.status(404).json({ success: false, message: "Visa not found" });

    const visaData = {
      ...v.toObject(),
      requiredDocuments: Array.isArray(v.requiredDocuments) ? v.requiredDocuments : [],
      image: v.image || ""
    };

    res.json({ success: true, visa: visaData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ADD new visa
// POST
app.post(
  "/api/admin/visas",
  upload.fields([{ name: "image", maxCount: 1 }]), // Use fields instead of single
  async (req, res) => {
    try {
      const data = { ...req.body };

      // ===== Handle image upload =====
      if (req.files?.image?.length) {
        const file = req.files.image[0];
        const url = file.path || file.filename || file.secure_url;
        if (!url) {
          return res
            .status(400)
            .json({ success: false, message: "Image upload failed" });
        }
        data.image = url;
      } else if (req.body.existingImage) {
        data.image = req.body.existingImage;
      } else {
        data.image = ""; // default if no image
      }

      // ===== Handle requiredDocuments =====
      if (data.requiredDocuments) {
        if (typeof data.requiredDocuments === "string") {
          try {
            data.requiredDocuments = JSON.parse(data.requiredDocuments);
          } catch {
            data.requiredDocuments = data.requiredDocuments
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d);
          }
        }
      } else {
        data.requiredDocuments = [];
      }

      // ===== Save to MongoDB =====
      const newVisa = new Visa(data);
      await newVisa.save();

      res.json({
        success: true,
        message: "Visa added successfully",
        visa: newVisa,
      });
    } catch (err) {
      console.error("Error in POST /api/admin/visas:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);




// PUT (update)
app.put("/api/admin/visas/:id", upload.single("image"), async (req, res) => {
  try {
    const data = { ...req.body };

    if (req.file) data.image = req.file.path;
    if (!req.file && req.body.existingImage) data.image = req.body.existingImage;

    if (data.requiredDocuments) {
      if (typeof data.requiredDocuments === "string") {
        try {
          data.requiredDocuments = JSON.parse(data.requiredDocuments);
        } catch {
          data.requiredDocuments = data.requiredDocuments
            .split(",")
            .map(d => d.trim())
            .filter(d => d);
        }
      }
    } else {
      data.requiredDocuments = [];
    }

    const updatedVisa = await Visa.findByIdAndUpdate(req.params.id, data, { new: true });

    res.json({ success: true, message: "Visa updated successfully", visa: updatedVisa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});
;

// DELETE visa
app.delete("/api/admin/visas/:id", async (req, res) => {
  try {
    const v = await Visa.findById(req.params.id);
    if (!v) return res.status(404).json({ success: false, message: "Visa not found" });

    // Delete image from Cloudinary
    if (v.image) {
      const publicId = getPublicId(v.image);
      if (publicId) await cloudinary.uploader.destroy(publicId);
    }

    await Visa.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Visa deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


const flightSchema = new mongoose.Schema(
  {
    flightNumber: { type: String, required: true },
    airline: { type: String, required: true },
    logo: { type: String }, // Cloudinary URL or file path

    departure: {
      iataCode: { type: String, required: true },
      time: { type: String, required: true },
    },

    arrival: {
      iataCode: { type: String, required: true },
      time: { type: String, required: true },
    },

    duration: { type: String }, // e.g., "2h 30m"

    services: [
      {
        type: { type: String, required: true }, // Classic, Value, Flex
        price: { type: Number, required: true },
        features: [{ type: String }],
      },
    ],
  },
  { timestamps: true }
);

const Flight = mongoose.model("Flight", flightSchema, "flights");

// CREATE flight
app.post("/api/flights", upload.single("logo"), async (req, res) => {
  try {
    const { flightNumber, airline, departure, arrival, duration, services } = req.body;

    const flight = new Flight({
      flightNumber,
      airline,
      duration,
      departure: JSON.parse(departure),
      arrival: JSON.parse(arrival),
      services: JSON.parse(services),
      logo: req.file ? req.file.path : null,
    });

    await flight.save();
    res.status(201).json({ success: true, flight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to add flight" });
  }
});

// GET all flights
app.get("/api/flights", async (req, res) => {
  try {
    const flights = await Flight.find();
    res.json({ success: true, flights });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to get flights" });
  }
});

// GET single flight
app.get("/api/flight/:id", async (req, res) => {
  try {
    const flight = await Flight.findById(req.params.id);
    if (!flight)
      return res.status(404).json({ success: false, message: "Flight not found" });
    res.json({ success: true, flight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to get flight" });
  }
});

// UPDATE flight
app.put("/api/flight/:id", upload.single("logo"), async (req, res) => {
  try {
    const { flightNumber, airline, departure, arrival, duration, services, existingLogo } = req.body;

    const updatedFlight = await Flight.findByIdAndUpdate(
      req.params.id,
      {
        flightNumber,
        airline,
        duration,
        departure: JSON.parse(departure),
        arrival: JSON.parse(arrival),
        services: JSON.parse(services),
        logo: req.file ? req.file.path : existingLogo || null,
      },
      { new: true }
    );

    if (!updatedFlight)
      return res.status(404).json({ success: false, message: "Flight not found" });
    res.json({ success: true, flight: updatedFlight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update flight" });
  }
});

// DELETE flight
app.delete("/api/flight/:id", async (req, res) => {
  try {
    const flight = await Flight.findById(req.params.id);
    if (!flight) return res.status(404).json({ success: false, message: "Flight not found" });

    // Delete image (logo) from Cloudinary
    if (flight.logo) {
      const publicId = getPublicId(flight.logo);
      if (publicId) await cloudinary.uploader.destroy(publicId);
    }

    await Flight.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Flight deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});
// SEARCH flights
app.get("/api/flights/search", async (req, res) => {
  try {
    const { origin, destination, departureDate } = req.query;

    // Basic validation
    if (!origin || !destination) {
      return res.status(400).json({ success: false, message: "Origin and destination are required" });
    }

    // Build query
    const query = {
      "departure.iataCode": origin.toUpperCase(),
      "arrival.iataCode": destination.toUpperCase(),
    };

    // Optional: match by date if stored in flight object
    if (departureDate) {
      query.departureDate = departureDate;
    }

    const flights = await Flight.find(query);

    res.json({ success: true, flights });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to search flights" });
  }
});


const querySchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  adults: Number,
  children: Number,
  message: String,
  date: { type: Date, default: Date.now },
});
const Query = mongoose.model("Query", querySchema);
app.post("/api/query", async (req, res) => {
  try {
    const newQuery = new Query(req.body);
    await newQuery.save();
    res.status(201).json({ message: "Query submitted successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Something went wrong" });
  }
});
app.get("/api/query", async (req, res) => {
  try {
    const queries = await Query.find().sort({ date: -1 }); // latest first
    res.json(queries);
  } catch (err) {
    console.error("Error fetching queries:", err);
    res.status(500).json({ error: "Failed to fetch queries" });
  }
});
app.get("/api/admin/stats", async (req, res) => {
  try {
    const [packages, hotels, visas, flights, enquiries] = await Promise.all([
      Destination.countDocuments(),
      Hotel.countDocuments(),
      Visa.countDocuments(),
      Flight.countDocuments(),
      Query.countDocuments(), // ✅ total enquiries from Query collection
    ]);

    res.json({
      packages,
      hotels,
      visas,
      flights,
      enquiries,
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ message: "Error fetching stats" });
  }
});
app.get("/api/query/monthly", async (req, res) => {
  try {
    const monthly = await Query.aggregate([
      {
        $group: {
          _id: { $month: "$date" },
          total: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Map month numbers to names
   const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];
    const formatted = monthly.map(m => ({
      month: monthNames[m._id - 1],
      enquiries: m.total
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching monthly queries:", err);
    res.status(500).json({ error: "Failed to fetch monthly enquiries" });
  }
});
app.get("/health", (req, res) => res.status(200).send("ok"));
const PORT = process.env.PORT || 9000; app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
