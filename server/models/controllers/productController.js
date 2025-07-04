const path = require('path');
const { ethers } = require('ethers'); // Uncomment and configure for blockchain
const fs = require('fs');

const Product = require('../Product.js');
const { generateQRCode } = require('../../qr/generateQR.js');
const blockchain = require('../../utils/blockchain.js');
const { hashString } = require('../../utils/hash.js');

exports.addProduct = async (req, res) => {
  try {
    console.log('Adding product with data:', req.body);
    console.log('Files:', req.files);
    
    let certFile = null;
    let imageFile = null;
    let blockchainRefHash = req.body.blockchainRefHash || '';
    let txHash = null;
    
    // Handle certificate file
    if (req.files && req.files.certFile && req.files.certFile[0]) {
      const certFilePath = req.files.certFile[0].path;
      let certBuffer = null;
      try {
        certBuffer = fs.readFileSync(certFilePath);
      } catch (err) {
        console.error('Error reading certificate file from disk:', err);
      }
      certFile = `/uploads/${req.files.certFile[0].filename}`;
      if (certBuffer) {
        blockchainRefHash = hashString(certBuffer);
      }
      console.log('Certificate file processed:', req.files.certFile[0].originalname);
    }
    
    // Handle image file
    if (req.files && req.files.imageFile && req.files.imageFile[0]) {
      const imageBuffer = req.files.imageFile[0].buffer;
      imageFile = `/uploads/${req.files.imageFile[0].filename}`;
      console.log('Image file processed:', req.files.imageFile[0].originalname);
    }

    // Blockchain integration (enabled)
    try {
      txHash = await blockchain.addProductOnChain({
        productId: req.body.productId,
        name: req.body.name,
        origin: req.body.origin,
        manufacturer: req.body.manufacturer,
        certificationHash: blockchainRefHash,
      });
      console.log('Blockchain txHash:', txHash);
    } catch (blockchainError) {
      console.error('Blockchain error:', blockchainError);
      // Optionally, you can return an error or continue without blockchain
      // return res.status(500).json({ error: 'Blockchain error', details: blockchainError.message });
    }

    const product = new Product({ 
      ...req.body, 
      certFile: certFile || null, 
      imageFile: imageFile || null,
      blockchainRefHash: txHash || blockchainRefHash || 'mock-hash-' + Date.now(),
      certificationHash: blockchainRefHash, // Store the actual certification hash
      createdByWallet: req.user.email // Use email as wallet for now
    });
    
    await product.save();
    console.log('Product saved successfully:', product);

    // Generate QR code
    let qrCode = null;
    try {
      qrCode = await generateQRCode(product.productId);
      console.log('QR code generated successfully');
    } catch (qrError) {
      console.error('QR generation error:', qrError);
    }

    res.status(201).json({ 
      message: 'Product added successfully',
      product: product.toObject(), 
      qrCode, 
      blockchainTx: txHash || blockchainRefHash || 'mock-hash-' + Date.now() 
    });
  } catch (err) {
    console.error('Error in addProduct:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    if (!stage) {
      return res.status(400).json({ error: 'Stage is required' });
    }

    let txHash = null;
    try {
      txHash = await blockchain.updateStageOnChain(id, stage);
    } catch (blockchainError) {
      console.error('Blockchain error:', blockchainError);
      // Optionally continue without blockchain
    }

    const product = await Product.findOneAndUpdate(
      { productId: id },
      { $push: { stages: stage }, blockchainRefHash: txHash || undefined },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({ ...product.toObject(), blockchainTx: txHash });
  } catch (err) {
    console.error('Error in updateProduct:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findOne({ productId: id });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    let onChain = null;
    try {
      onChain = await blockchain.getProductOnChain(id);
    // Fix: Convert all BigInt values in onChain to strings
      function bigIntToString(obj) {
        if (typeof obj === 'bigint') return obj.toString();
        if (Array.isArray(obj)) return obj.map(bigIntToString);
        if (obj && typeof obj === 'object') {
          return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, bigIntToString(v)])
          );
        }
        return obj;
      }
      onChain = bigIntToString(onChain);

    } catch (e) {
      console.error('Blockchain error in getProduct:', e);
    }

    res.json({ ...product.toObject(), onChain });
  } catch (err) {
    console.error('Error in getProduct:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProductByCertHash = async (req, res) => {
  try {
    const { certHash } = req.params;
    
    // First try to find by certificationHash field
    let product = await Product.findOne({ certificationHash: certHash });
    
    // If not found, try to find by blockchainRefHash (for backward compatibility)
    if (!product) {
      product = await Product.findOne({ blockchainRefHash: certHash });
    }
    
    if (!product) return res.status(404).json({ error: 'Product not found' });

    let onChain = null;
    try {
      onChain = await blockchain.getProductOnChain(product.productId);
      // Convert BigInt values to strings
      function bigIntToString(obj) {
        if (typeof obj === 'bigint') return obj.toString();
        if (Array.isArray(obj)) return obj.map(bigIntToString);
        if (obj && typeof obj === 'object') {
          return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, bigIntToString(v)])
          );
        }
        return obj;
      }
      onChain = bigIntToString(onChain);
    } catch (e) {
      console.error('Blockchain error in getProductByCertHash:', e);
    }

    res.json({ ...product.toObject(), onChain });
  } catch (err) {
    console.error('Error in getProductByCertHash:', err);
    res.status(500).json({ error: err.message });
  }
};
