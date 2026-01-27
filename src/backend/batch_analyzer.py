#!/usr/bin/env python3
"""
Mixed In AI - Batch Audio Analysis
Analyzes multiple audio files in parallel using multi-threading.
"""

import sys
import json
import os
import logging
import signal
import atexit

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger(__name__)

# Global flag to track if we're shutting down
_shutting_down = False

def signal_handler(signum, frame):
    """Handle signals gracefully."""
    global _shutting_down
    _shutting_down = True
    logger.warning(f"Received signal {signum}, shutting down gracefully...")
    # Output error JSON before exiting
    try:
        print(json.dumps({
            'error': 'PROCESS_TERMINATED',
            'message': f'Process was terminated by signal {signum}',
            'signal': signum
        }))
        sys.stdout.flush()
    except:
        pass
    sys.exit(128 + signum)

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
if hasattr(signal, 'SIGBREAK'):  # Windows
    signal.signal(signal.SIGBREAK, signal_handler)

def cleanup_handler():
    """Cleanup handler for atexit."""
    global _shutting_down
    if _shutting_down:
        logger.info("Cleanup complete")

def main():
    """Main entry point for batch analysis."""
    global _shutting_down
    
    # Register cleanup handler
    atexit.register(cleanup_handler)
    
    try:
        if len(sys.argv) < 2:
            logger.error("Usage: python batch_analyzer.py <file1> [file2] [file3] ...")
            print(json.dumps({
                'error': 'INVALID_USAGE',
                'message': 'Usage: python batch_analyzer.py <file1> [file2] [file3] ...'
            }))
            sys.stdout.flush()
            sys.exit(1)
        
        file_paths = sys.argv[1:]
        
        # Validate all files exist
        for file_path in file_paths:
            if _shutting_down:
                logger.warning("Shutdown requested, aborting file validation")
                sys.exit(130)
            if not os.path.exists(file_path):
                logger.error(f"File does not exist: {file_path}")
                print(json.dumps({
                    'error': 'FILE_NOT_FOUND',
                    'message': f'File does not exist: {file_path}',
                    'file_path': file_path
                }))
                sys.stdout.flush()
                sys.exit(1)
        
        # Import analyzer
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from analyzer import AudioAnalyzer
        
        logger.info(f"Starting batch analysis for {len(file_paths)} files...")
        analyzer = AudioAnalyzer()
        
        # Progress callback to output progress updates
        def progress_callback(current, total, current_file):
            if _shutting_down:
                return
            try:
                progress_data = {
                    'type': 'progress',
                    'current': current,
                    'total': total,
                    'file': current_file
                }
                # Output progress to stderr so it doesn't interfere with JSON output
                print(json.dumps(progress_data), file=sys.stderr)
                sys.stderr.flush()
            except Exception as e:
                logger.warning(f"Progress callback error: {e}")
        
        # Run batch analysis
        if _shutting_down:
            logger.warning("Shutdown requested before analysis")
            sys.exit(130)
            
        results = analyzer.analyze_batch_parallel(file_paths, progress_callback=progress_callback)
        
        if _shutting_down:
            logger.warning("Shutdown requested during analysis")
            sys.exit(130)
        
        # Output final results as JSON
        output = {
            'results': results,
            'total': len(results),
            'successful': len([r for r in results if r.get('analysis') is not None]),
            'failed': len([r for r in results if r.get('error') is not None])
        }
        
        print(json.dumps(output, indent=2))
        sys.stdout.flush()
        logger.info("Batch analysis completed successfully")
        
    except KeyboardInterrupt:
        logger.warning("Interrupted by user")
        print(json.dumps({
            'error': 'INTERRUPTED',
            'message': 'Batch analysis was interrupted by user'
        }))
        sys.stdout.flush()
        sys.exit(130)
    except SystemExit:
        raise  # Re-raise SystemExit
    except Exception as e:
        logger.error(f"Batch analysis failed: {str(e)}")
        import traceback
        error_output = {
            'error': 'BATCH_ANALYSIS_FAILED',
            'message': str(e),
            'traceback': traceback.format_exc()
        }
        try:
            print(json.dumps(error_output))
            sys.stdout.flush()
        except:
            # If we can't output JSON, at least try to log
            logger.error(f"Failed to output error JSON: {traceback.format_exc()}")
        sys.exit(1)

if __name__ == "__main__":
    main()
