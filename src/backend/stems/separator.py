#!/usr/bin/env python3
"""
Mixed In AI - Stem Separator
Separates audio into stems (vocals, drums, bass, other) using Demucs.
"""

import os
import subprocess
import logging
from typing import Dict, Any, List, Optional
import json

logger = logging.getLogger(__name__)

class StemSeparator:
    """
    Wrapper for Demucs stem separation.
    """
    
    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir
        
    def check_demucs_installed(self) -> bool:
        """Check if Demucs is available."""
        try:
            # Check if we can import it
            import demucs
            return True
        except ImportError:
            # Check CLI
            try:
                subprocess.run(["demucs", "--help"], capture_output=True)
                return True
            except FileNotFoundError:
                return False

    def separate(self, file_path: str, model: str = "htdemucs_ft") -> Dict[str, Any]:
        """
        Separate audio into stems.
        
        Args:
            file_path: Path to audio file
            model: Demucs model name (htdemucs_ft is good balance)
            
        Returns:
            Dict containing paths to separated stems
        """
        if not os.path.exists(file_path):
             return {"error": f"File not found: {file_path}"}
             
        # Determine output folder
        out_root = self.output_dir or os.path.join(os.path.dirname(file_path), "Stems")
        os.makedirs(out_root, exist_ok=True)
        
        filename = os.path.splitext(os.path.basename(file_path))[0]
        track_out_dir = os.path.join(out_root, "htdemucs_ft", filename) # Default demucs structure
        
        logger.info(f"Starting separation for {filename}...")
        
        try:
            # Run Demucs as subprocess to avoid blocking main thread if running in same process 
            # (though multiprocessing is used by demucs internally).
            # Using CLI invocation is often safer for environment management.
            
            cmd = [
                "demucs",
                "-n", model,
                "--out", out_root,
                file_path
            ]
            
            # This is heavy CPU/GPU operation
            process = subprocess.run(cmd, capture_output=True, text=True)
            
            if process.returncode != 0:
                logger.error(f"Demucs failed: {process.stderr}")
                return {"error": f"Demucs failed: {process.stderr}"}
                
            # Verify outputs
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                 path = os.path.join(track_out_dir, f"{stem_name}.wav")
                 if os.path.exists(path):
                     stems[stem_name] = path
            
            logger.info(f"Separation complete: {stems}")
            return {"status": "success", "stems": stems}
            
        except Exception as e:
            logger.error(f"Separation error: {e}")
            return {"error": str(e)}

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        sep = StemSeparator()
        print(json.dumps(sep.separate(sys.argv[1]), indent=2))
    else:
        print("Usage: python separator.py <audio_file>")
