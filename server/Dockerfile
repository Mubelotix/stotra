# Use Node.js as the base image
FROM node:latest

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if exists)
COPY package*.json ./

# Install dependencies
RUN npm install --ignore-scripts

# Copy the rest of the application source code
COPY . .

# Build the TypeScript code
RUN npm run tsc

# Expose the port your app runs on
EXPOSE 3000

RUN ls /usr/src/app/dist

# Start the application
CMD ["node", "dist/src/index.js"]
