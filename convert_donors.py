import re
import csv
import os

def parse_donors_file(input_file, output_file):
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found.")
        return

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split lines and process
    lines = content.splitlines()
    records = []
    current_record = {}
    
    # Regex for ID: 2 letters, 4 digits, optional dash and letter/s
    # Examples: FH0895, TK1092-D, KM1198
    id_pattern = re.compile(r'^[A-Z]{2}\d{4}(-[A-Z])?$')
    
    # List to keep track of all encountered keys to ensure consistent CSV headers
    all_keys = set()
    all_keys.update(["ID"]) # Ensure ID is always a column

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        if not line:
            i += 1
            continue

        if id_pattern.match(line):
            # Save previous record if exists
            if current_record:
                records.append(current_record)
            
            # Start new record
            current_record = {'ID': line}
            i += 1
        else:
            # Assume it's a Key
            if line.endswith(':'):
                key = line[:-1] # Remove colon
                all_keys.add(key)
                
                # Check next line for value
                if i + 1 < len(lines):
                    next_line = lines[i+1].strip()
                    
                    # Check if next line is a new ID or a new Key (ending with :)
                    # If next line is a valid ID or ends with :, current value is empty
                    is_next_id = id_pattern.match(next_line)
                    is_next_key = next_line.endswith(':') and not is_next_id 
                    # Note: strict check for ID pattern to avoid confusion
                    
                    if is_next_id or (is_next_key):
                         current_record[key] = ""
                         # Do not increment i, we need to process this next line as a key or ID
                    else:
                        current_record[key] = next_line
                        i += 1 # Skip the value line we just read
                else:
                    # End of file
                    current_record[key] = ""
                
            i += 1

    # Append the last record
    if current_record:
        records.append(current_record)

    # Sort keys for consistent CSV output
    # Sort: ID first, then alphabetical or as appeared? Let's do alphabetical for others
    sorted_keys = ['ID'] + sorted([k for k in all_keys if k != 'ID'])

    print(f"Found {len(records)} records.")
    
    with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=sorted_keys)
        writer.writeheader()
        writer.writerows(records)
        
    print(f"Successfully wrote to {output_file}")

if __name__ == "__main__":
    input_path = "donors_fresh.txt"
    output_path = "records.csv"
    parse_donors_file(input_path, output_path)
