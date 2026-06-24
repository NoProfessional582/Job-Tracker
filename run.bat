@echo off
echo ===================================================
echo   Job Tracker Startup Script
echo ===================================================
echo.
echo Installing/Verifying required libraries (Flask)...
python -m pip install --upgrade pip
pip install -r requirements.txt
echo.
echo ---------------------------------------------------
echo   Job Tracker is now starting!
echo   Open your browser and go to: http://localhost:5000
echo ---------------------------------------------------
echo.
python app.py
pause
