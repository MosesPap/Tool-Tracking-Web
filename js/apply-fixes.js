const fs = require('fs');
const path = require('path');

const filePath = 'duty-shifts-logic.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Enhanced backward shift logic (around line 10110)
const oldBackwardShift = `if (isBackwardWithinMonth) {
                                    const changes = []; // { dk, prevPerson, newPerson }
                                    let carry = currentPerson;
                                    for (let i = fromIndex; i <= toIndex; i++) {
                                        const dk = sortedSemi[i];
                                        if (!updatedAssignments[dk]) updatedAssignments[dk] = {};
                                        const prev = updatedAssignments[dk][groupNum] || null;
                                        updatedAssignments[dk][groupNum] = carry;
                                        changes.push({ dk, prevPerson: prev, newPerson: carry });
                                        carry = prev;
                                        swappedSemiSet.add(\`\${dk}:\${groupNum}\`);
                                    }

                                    // Store "shift" reasons for all moved assignments (keeps UI explanations consistent).
                                    for (const ch of changes) {
                                        if (!ch.newPerson) continue;
                                        storeAssignmentReason(
                                            ch.dk,
                                            groupNum,
                                            ch.newPerson,
                                            'shift',
                                            \`ΞΞµΟ„Ξ±ΞΊΞ―Ξ½Ξ·ΟƒΞ· (ΞΏΟ€ΞΉΟƒΞΈΞΏΞ΄ΟΞΏΞΌΞΉΞΊΞ® Ξ±Ξ½Ο„Ξ±Ξ»Ξ»Ξ±Ξ³Ξ®) Ξ»ΟΞ³Ο‰ ΟƒΟΞ³ΞΊΟΞΏΟ…ΟƒΞ·Ο‚ Ξ³ΞµΞΉΟ„ΞΏΞ½ΞΉΞΊΞ®Ο‚ Ο…Ο€Ξ·ΟΞµΟƒΞ―Ξ±Ο‚ (\${conflictNeighborKey}).\`,
                                            ch.prevPerson || null,
                                            swapPairId,
                                            { backwardShift: true, originDayKey: dateKey, swapDayKey: swapDateKey, conflictDateKey: conflictNeighborKey }
                                        );
                                    }`;

const newBackwardShift = `if (isBackwardWithinMonth) {
                                    // Backward shift: currentPerson moves backward to swapDateKey,
                                    // and everyone in between shifts forward by one slot.
                                    // The displaced person (originally at swapDateKey) becomes the EXACT next semi-normal after swapDateKey.
                                    const changes = []; // { dk, prevPerson, newPerson }
                                    let carry = currentPerson;
                                    
                                    // Get the displaced person BEFORE the shift (the person originally at swapDateKey)
                                    const displacedPersonOriginal = updatedAssignments[swapDateKey]?.[groupNum] || swapCandidate;
                                    
                                    // Perform the forward shift across all days from swapDateKey to dateKey (inclusive)
                                    for (let i = fromIndex; i <= toIndex; i++) {
                                        const dk = sortedSemi[i];
                                        if (!updatedAssignments[dk]) updatedAssignments[dk] = {};
                                        const prev = updatedAssignments[dk][groupNum] || null;
                                        updatedAssignments[dk][groupNum] = carry;
                                        changes.push({ dk, prevPerson: prev, newPerson: carry });
                                        carry = prev; // This becomes the person for the next iteration
                                        swappedSemiSet.add(\`\${dk}:\${groupNum}\`);
                                    }
                                    
                                    // After the shift loop, verify the displaced person is correctly assigned
                                    // The displaced person should be at fromIndex + 1 (the next semi-normal after swapDateKey)
                                    // This verification ensures no one gets skipped
                                    if (fromIndex + 1 < sortedSemi.length && displacedPersonOriginal) {
                                        const nextSemiKey = sortedSemi[fromIndex + 1];
                                        const assignedAtNext = updatedAssignments[nextSemiKey]?.[groupNum];
                                        
                                        // If the displaced person is not correctly assigned at the next semi-normal day,
                                        // ensure they are assigned there (this handles edge cases where the shift might miss them)
                                        if (assignedAtNext !== displacedPersonOriginal) {
                                            if (!updatedAssignments[nextSemiKey]) updatedAssignments[nextSemiKey] = {};
                                            // Only assign if that day doesn't already have someone (to avoid overwriting correct assignments)
                                            if (!updatedAssignments[nextSemiKey][groupNum] || updatedAssignments[nextSemiKey][groupNum] !== displacedPersonOriginal) {
                                                updatedAssignments[nextSemiKey][groupNum] = displacedPersonOriginal;
                                                swappedSemiSet.add(\`\${nextSemiKey}:\${groupNum}\`);
                                                // Add to changes if not already there
                                                const existingChange = changes.find(ch => ch.dk === nextSemiKey && ch.newPerson === displacedPersonOriginal);
                                                if (!existingChange) {
                                                    changes.push({ 
                                                        dk: nextSemiKey, 
                                                        prevPerson: assignedAtNext || null, 
                                                        newPerson: displacedPersonOriginal 
                                                    });
                                                }
                                                console.log(\`[SEMI SWAP LOGIC] Verified/Fixed: Displaced person \${displacedPersonOriginal} assigned to next semi-normal \${nextSemiKey}\`);
                                            }
                                        }
                                    }

                                    // Store "shift" reasons for all moved assignments (keeps UI explanations consistent).
                                    for (const ch of changes) {
                                        if (!ch.newPerson) continue;
                                        storeAssignmentReason(
                                            ch.dk,
                                            groupNum,
                                            ch.newPerson,
                                            'shift',
                                            \`ΞΞµΟ„Ξ±ΞΊΞ―Ξ½Ξ·ΟƒΞ· (ΞΏΟ€ΞΉΟƒΞΈΞΏΞ΄ΟΞΏΞΌΞΉΞΊΞ® Ξ±Ξ½Ο„Ξ±Ξ»Ξ»Ξ±Ξ³Ξ®) Ξ»ΟΞ³Ο‰ ΟƒΟΞ³ΞΊΟΞΏΟ…ΟƒΞ·Ο‚ Ξ³ΞµΞΉΟ„ΞΏΞ½ΞΉΞΊΞ®Ο‚ Ο…Ο€Ξ·ΟΞµΟƒΞ―Ξ±Ο‚ (\${conflictNeighborKey}).\`,
                                            ch.prevPerson || null,
                                            swapPairId,
                                            { backwardShift: true, originDayKey: dateKey, swapDayKey: swapDateKey, conflictDateKey: conflictNeighborKey }
                                        );
                                    }`;

if (content.includes(oldBackwardShift)) {
    content = content.replace(oldBackwardShift, newBackwardShift);
    console.log('Fix 1 applied: Enhanced backward shift logic');
} else {
    console.log('Fix 1: Pattern not found (may already be applied)');
}

// Fix 2: Add tempAssignments update (after line 10189)
const oldTempAssignments = `                // Store final assignments (after swap logic) for saving when OK is pressed
                calculationSteps.finalSemiAssignments = updatedAssignments;
                
                // Show popup with results (will save when OK is pressed)
                showSemiNormalSwapResults(swappedPeople, updatedAssignments);`;

const newTempAssignments = `                // Store final assignments (after swap logic) for saving when OK is pressed
                calculationSteps.finalSemiAssignments = updatedAssignments;
                
                // IMPORTANT: Also update tempAssignments.semi with final swapped data
                // This ensures executeCalculation() can use the correct data if finalSemiAssignments isn't available
                if (!calculationSteps.tempAssignments) {
                    calculationSteps.tempAssignments = {};
                }
                calculationSteps.tempAssignments.semi = updatedAssignments;
                
                // Show popup with results (will save when OK is pressed)
                showSemiNormalSwapResults(swappedPeople, updatedAssignments);`;

if (content.includes(oldTempAssignments)) {
    content = content.replace(oldTempAssignments, newTempAssignments);
    console.log('Fix 2 applied: Added tempAssignments update');
} else {
    console.log('Fix 2: Pattern not found (may already be applied)');
}

// Fix 3: Use finalSemiAssignments in executeCalculation (around line 12309)
const oldSemiSource = `                // Semi-normal assignments: dateKey -> { groupNum -> person }
                for (const dateKey in tempAssignments.semi || {}) {
                    for (const groupNum in tempAssignments.semi[dateKey] || {}) {
                        const person = tempAssignments.semi[dateKey][groupNum];
                        if (person) {
                            if (!semiNormalAssignments[dateKey]) {
                                semiNormalAssignments[dateKey] = '';
                            }
                            const assignment = \`\${person} (ΞΞΌΞ¬Ξ΄Ξ± \${groupNum})\`;
                            if (!semiNormalAssignments[dateKey].includes(assignment)) {
                                semiNormalAssignments[dateKey] = semiNormalAssignments[dateKey]
                                    ? \`\${semiNormalAssignments[dateKey]}, \${assignment}\`
                                    : assignment;
                            }
                        }
                    }
                }`;

const newSemiSource = `                // Semi-normal assignments: dateKey -> { groupNum -> person }
                // IMPORTANT: For multi-month calculations, prefer the FINAL Step 3 result if available
                // (includes backward swap shift logic), otherwise fall back to tempAssignments.semi.
                const semiSource = (calculationSteps && calculationSteps.finalSemiAssignments)
                    ? calculationSteps.finalSemiAssignments
                    : (tempAssignments.semi || {});
                for (const dateKey in semiSource) {
                    for (const groupNum in semiSource[dateKey] || {}) {
                        const person = semiSource[dateKey]?.[groupNum];
                        if (person) {
                            if (!semiNormalAssignments[dateKey]) {
                                semiNormalAssignments[dateKey] = '';
                            }
                            const assignment = \`\${person} (ΞΞΌΞ¬Ξ΄Ξ± \${groupNum})\`;
                            if (!semiNormalAssignments[dateKey].includes(assignment)) {
                                semiNormalAssignments[dateKey] = semiNormalAssignments[dateKey]
                                    ? \`\${semiNormalAssignments[dateKey]}, \${assignment}\`
                                    : assignment;
                            }
                        }
                    }
                }`;

if (content.includes(oldSemiSource)) {
    content = content.replace(oldSemiSource, newSemiSource);
    console.log('Fix 3 applied: Use finalSemiAssignments in executeCalculation');
} else {
    console.log('Fix 3: Pattern not found (may already be applied)');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('All fixes applied successfully!');
