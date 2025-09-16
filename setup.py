#!/usr/bin/env python3
"""
Setup script for Mixed In AI
Installs dependencies and sets up the development environment.
"""

import subprocess
import sys
import os
import platform

def run_command(command, description):
    """Run a command and handle errors."""
    print(f"🔧 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed:")
        print(f"   Command: {command}")
        print(f"   Error: {e.stderr}")
        return False

def check_python_version():
    """Check if Python version is compatible."""
    print("🐍 Checking Python version...")
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print(f"❌ Python 3.8+ required, found {version.major}.{version.minor}")
        return False
    print(f"✅ Python {version.major}.{version.minor}.{version.micro} is compatible")
    return True

def check_node_version():
    """Check if Node.js version is compatible."""
    print("🟢 Checking Node.js version...")
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True, check=True)
        version_str = result.stdout.strip()
        version_parts = version_str.replace('v', '').split('.')
        major = int(version_parts[0])
        minor = int(version_parts[1])
        
        if major < 16:
            print(f"❌ Node.js 16+ required, found {version_str}")
            return False
        print(f"✅ Node.js {version_str} is compatible")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ Node.js not found. Please install Node.js 16+ from https://nodejs.org/")
        return False

def install_python_dependencies():
    """Install Python dependencies."""
    print("📦 Installing Python dependencies...")
    
    # Check if pip is available
    try:
        subprocess.run([sys.executable, '-m', 'pip', '--version'], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        print("❌ pip not found. Please install pip first.")
        return False
    
    # Install requirements
    if not run_command(f"{sys.executable} -m pip install -r requirements.txt", "Installing Python packages"):
        return False
    
    return True

def install_node_dependencies():
    """Install Node.js dependencies."""
    print("📦 Installing Node.js dependencies...")
    
    # Check if npm is available
    try:
        subprocess.run(['npm', '--version'], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ npm not found. Please install Node.js first.")
        return False
    
    # Install dependencies
    if not run_command("npm install", "Installing Node.js packages"):
        return False
    
    return True

def test_installation():
    """Test if the installation works."""
    print("🧪 Testing installation...")
    
    # Test Python backend
    print("🔬 Testing Python backend...")
    if not run_command(f"{sys.executable} test_analyzer.py", "Running Python tests"):
        print("⚠️  Python backend test failed, but installation may still work")
    
    # Test Node.js build
    print("🔬 Testing Node.js build...")
    if not run_command("npm run build", "Building frontend"):
        print("⚠️  Frontend build failed, but installation may still work")
    
    return True

def create_directories():
    """Create necessary directories."""
    print("📁 Creating directories...")
    
    directories = [
        'dist',
        'assets',
        'src/backend/tools'
    ]
    
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        print(f"✅ Created directory: {directory}")

def main():
    """Main setup function."""
    print("🎵 Mixed In AI - Setup Script")
    print("=" * 50)
    
    # Check system requirements
    if not check_python_version():
        return 1
    
    if not check_node_version():
        return 1
    
    # Create directories
    create_directories()
    
    # Install dependencies
    if not install_python_dependencies():
        print("❌ Failed to install Python dependencies")
        return 1
    
    if not install_node_dependencies():
        print("❌ Failed to install Node.js dependencies")
        return 1
    
    # Test installation
    test_installation()
    
    print("\n🎉 Setup completed successfully!")
    print("\n🚀 To start development:")
    print("   npm run dev")
    print("\n📦 To build for distribution:")
    print("   npm run dist")
    print("\n🧪 To run tests:")
    print("   python test_analyzer.py")
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 