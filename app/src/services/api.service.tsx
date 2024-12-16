import axios from "axios";

const instance = axios.create({
	baseURL: "/api",
	headers: {
		"Content-Type": "application/json",
	},
});

instance.interceptors.request.use(
	(config) => config,
	(error) => {
		return Promise.reject(error);
	},
);

export default instance;
