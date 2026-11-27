@echo off
rem Instala o que falta e liga o bot. Basta dar dois cliques neste arquivo.
title Figurinhas com som para WhatsApp
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
if errorlevel 1 pause
