from pathlib import Path

p = Path('.github/agent-combat.py')
text = p.read_text()
old = '''replace_once("app/game.tsx",
''' + "'''" + '''    let hudDelay = 0;\n\n    // Rendering geometry.\n''' + "'''" + ''',
''' + "'''" + '''    let hudDelay = 0;\n    let lastGunFeedbackTick = -999;\n\n    const vibrateCombat = (event: \"gun\" | \"hull\") => {\n      if (reducedMotionRef.current || !hapticsAllow(combatHapticsRef.current, event)) return;\n      if (typeof navigator === \"undefined\" || !(\"vibrate\" in navigator)) return;\n      navigator.vibrate(event === \"gun\" ? 9 : 24);\n    };\n\n    const cannonImpactFeedback = (game: Game, bullet: Bullet) => {\n      if (bullet.enemy || bullet.special || game.cycles - lastGunFeedbackTick < 2) return;\n      lastGunFeedbackTick = game.cycles;\n      vibrateCombat(\"gun\");\n      if (cannonHitSoundRef.current) playCue(\"cannon-hit\", 0.075);\n    };\n\n    // Rendering geometry.\n''' + "'''" + ''')'''
new = '''replace_once("app/game.tsx",
''' + "'''" + '''    let hudDelay = 0;\n''' + "'''" + ''',
''' + "'''" + '''    let hudDelay = 0;\n    let lastGunFeedbackTick = -999;\n\n    const vibrateCombat = (event: \"gun\" | \"hull\") => {\n      if (reducedMotionRef.current || !hapticsAllow(combatHapticsRef.current, event)) return;\n      if (typeof navigator === \"undefined\" || !(\"vibrate\" in navigator)) return;\n      navigator.vibrate(event === \"gun\" ? 9 : 24);\n    };\n\n    const cannonImpactFeedback = (game: Game, bullet: Bullet) => {\n      if (bullet.enemy || bullet.special || game.cycles - lastGunFeedbackTick < 2) return;\n      lastGunFeedbackTick = game.cycles;\n      vibrateCombat(\"gun\");\n      if (cannonHitSoundRef.current) playCue(\"cannon-hit\", 0.075);\n    };\n''' + "'''" + ''')'''
if old not in text:
    raise SystemExit('combat canvas anchor block not found')
p.write_text(text.replace(old, new, 1))
Path('.github/fix-combat-agent.py').unlink()
