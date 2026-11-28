@echo off
rem Faz o bot ligar sozinho quando voce entrar no Windows. Dois cliques de novo desfazem.
title Ligar o bot junto com o Windows
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ligar-com-windows.ps1" %*
