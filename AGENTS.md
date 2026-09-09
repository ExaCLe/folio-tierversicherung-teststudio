# Zusammenarbeit

- Vor Beginn einer neuen Änderung den Arbeitsbaum prüfen und `git pull --ff-only` ausführen. Lokale Änderungen erhalten; bei einem Konflikt oder fehlendem Upstream erst den Git-Stand klären. Bei gemeinsamem Arbeitsbaum synchronisiert der Orchestrator einmal vor der Delegation, Unteragenten arbeiten auf diesem Stand.
- Für Unteraufgaben ausschließlich Sol oder Luna einsetzen. Der Hauptagent koordiniert Umsetzung, Integration und Prüfung.
