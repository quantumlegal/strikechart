#!/bin/bash
# StrikeChart VPS Setup Script
# Run this on a fresh Ubuntu 22.04 VPS

set -e

echo "=========================================="
echo "  StrikeChart VPS Setup"
echo "=========================================="

# Update system
echo "[1/7] Updating system..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
echo "[2/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
echo "[3/7] Installing PM2..."
sudo npm install -g pm2

# Install Nginx
echo "[4/7] Installing Nginx..."
sudo apt install -y nginx

# Create app directory
echo "[5/7] Setting up application..."
sudo mkdir -p /var/www/strikechart
sudo chown $USER:$USER /var/www/strikechart

# Create logs directory
mkdir -p /var/www/strikechart/logs

echo "[6/7] Configuring firewall..."
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw --force enable

echo "[7/7] Setup complete!"
echo ""
echo "Next steps:"
echo "1. Upload your project files to /var/www/strikechart"
echo "2. cd /var/www/strikechart"
echo "3. npm install"
echo "4. npm run build"
echo "5. pm2 start ecosystem.config.cjs"
echo "6. pm2 save && pm2 startup"
echo ""
echo "=========================================="
