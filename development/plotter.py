import json
import argparse
import matplotlib.pyplot as plt
import pandas as pd

# Function to load data from a JSON file
def load_json_data(file_path):
    with open(file_path, 'r') as f:
        return json.load(f)

# Main function to plot the data
def plot_data(file_path):
    # Load the JSON data from the provided file path
    data = load_json_data(file_path)

    # Initialize the plot
    plt.figure(figsize=(10, 6))

    # Iterate through all the datasets (each with a 'label' and 'data')
    for entry in data:
        if 'data' in entry:  # Check if the 'data' key exists
            data_points = entry['data']  # Get the data points (list of dictionaries)

            # Extract timestamps and values from the data
            timestamps = [point['timestamp'] for point in data_points]
            values = [point['value'] for point in data_points]

            # Convert timestamps to datetime objects
            timestamps = pd.to_datetime(timestamps)

            # Plot the data on the same chart
            plt.plot(timestamps, values, label=entry.get('label', 'Unknown Label'))

    # Customize the chart
    plt.xlabel('Timestamp')
    plt.ylabel('Value')
    plt.title('Sensor Data - Line Chart')
    plt.xticks(rotation=45)  # Rotate timestamps for better readability
    plt.tight_layout()  # Adjust the plot to fit everything
    plt.grid(True)
    plt.legend()  # Show the legend for all datasets

    # Show the plot
    plt.show()

# Set up argument parsing
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Plot data from a JSON file")
    parser.add_argument("file_path", help="Path to the JSON file")
    args = parser.parse_args()

    # Plot the data
    plot_data(args.file_path)
